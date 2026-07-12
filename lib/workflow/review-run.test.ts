import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort, DraftReviewInput, PortResult, DraftReviewOutput } from "../agents/ports";
import { reviewDecisions } from "../db/schema";
import { and, eq } from "drizzle-orm";
import * as svc from "../services/initiative-service";
import { getRunProgress, runSingleDomainDraft, startDraftRun } from "./review-run";

const REQUESTER = { id: "priya-raman", role: "requester" as const };

async function setUpChampionInReview(db: TestDb) {
  const draft = await svc.createDraft(db, {
    payload: CHAMPION_PREFILL_PAYLOAD,
    requesterActor: REQUESTER,
    requesterName: "Priya Raman",
  });
  await svc.submitIntake(db, draft.initiativeId, REQUESTER);
  const triageResult = await svc.triage(db, draft.initiativeId);
  if (triageResult.branch !== "review") throw new Error("expected champion to route to review");
  return { initiativeId: draft.initiativeId, cycleId: triageResult.cycleId, domains: triageResult.requiredDomains };
}

/** Wraps the deterministic mock port so a chosen set of domains always fail. */
function portFailingFor(domains: string[], mode: "reject" | "error-result" = "error-result"): AgentPort {
  const base = createMockAgentPort();
  return {
    ...base,
    async draftReview(input: DraftReviewInput): Promise<PortResult<DraftReviewOutput>> {
      if (domains.includes(input.domain)) {
        if (mode === "reject") {
          throw new Error(`simulated failure for ${input.domain}`);
        }
        return { ok: false, error: { kind: "provider", message: `simulated failure for ${input.domain}`, retryable: true } };
      }
      return base.draftReview(input);
    },
  };
}

/**
 * Wraps the deterministic mock port so `draftReview` for the given domains
 * fails on its first N calls (per domain) and then delegates to the healthy
 * mock. Used to prove the retry path: a domain whose first attempt fails
 * but whose retry succeeds should still end up `drafted`.
 */
function portFailingNTimesThenSucceeding(domains: string[], failuresBeforeSuccess: number): AgentPort {
  const base = createMockAgentPort();
  const remainingFailures = new Map(domains.map((d) => [d, failuresBeforeSuccess]));
  return {
    ...base,
    async draftReview(input: DraftReviewInput): Promise<PortResult<DraftReviewOutput>> {
      const remaining = remainingFailures.get(input.domain);
      if (remaining !== undefined && remaining > 0) {
        remainingFailures.set(input.domain, remaining - 1);
        return {
          ok: false,
          error: { kind: "provider", message: `transient failure for ${input.domain}`, retryable: true },
        };
      }
      return base.draftReview(input);
    },
  };
}

/**
 * Wraps the deterministic mock port with a synchronous in/out counter around
 * each `draftReview` invocation, plus a fixed artificial delay so concurrent
 * calls are actually observable. `maxObservedConcurrent()` reports the true
 * instantaneous peak (increment happens synchronously the instant the call
 * starts, decrement synchronously the instant it finishes) — deliberately
 * NOT based on comparing `Date.now()` timestamps after the fact, since
 * wall-clock start/end windows can spuriously appear to overlap once
 * persistence work (a real DB write between one call finishing and the next
 * being dispatched) is added on top, even when true concurrency never
 * exceeds the limit.
 */
function portRecordingConcurrency(delayMs: number): {
  port: AgentPort;
  maxObservedConcurrent: () => number;
} {
  const base = createMockAgentPort();
  let active = 0;
  let maxActive = 0;
  const port: AgentPort = {
    ...base,
    async draftReview(input: DraftReviewInput): Promise<PortResult<DraftReviewOutput>> {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const result = await base.draftReview(input);
      active--;
      return result;
    },
  };
  return { port, maxObservedConcurrent: () => maxActive };
}

describe("lib/workflow/review-run", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("drafts 4 mocked domains concurrently and persists review_decisions rows (status drafted)", async () => {
    const { initiativeId } = await setUpChampionInReview(db);
    const fourDomains = ["responsible-ai", "privacy-hipaa", "clinical-safety", "legal"] as const;

    const result = await startDraftRun(db, initiativeId, [...fourDomains]);

    expect(result.outcomes).toHaveLength(4);
    expect(result.outcomes.every((o) => o.status === "drafted")).toBe(true);

    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, result.cycleId));
    const drafted = rows.filter((r) => fourDomains.includes(r.domain as (typeof fourDomains)[number]));
    expect(drafted).toHaveLength(4);
    for (const row of drafted) {
      expect(row.status).toBe("drafted");
      expect(row.draftMd).toBeTruthy();
    }
  });

  it("is idempotent per (cycle, domain): re-running never duplicates rows", async () => {
    const { initiativeId, cycleId } = await setUpChampionInReview(db);
    const domains = ["legal", "security"] as const;

    await startDraftRun(db, initiativeId, [...domains]);
    const afterFirst = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    const legalRowsAfterFirst = afterFirst.filter((r) => r.domain === "legal");
    expect(legalRowsAfterFirst).toHaveLength(1);

    // Re-run: since 'legal'/'security' are now 'drafted', startDraftRun should skip them
    // (no re-invocation, no duplicate row) per the (cycle, domain) uniqueness constraint.
    const second = await startDraftRun(db, initiativeId, [...domains]);
    expect(second.outcomes.every((o) => o.status === "skipped")).toBe(true);

    const afterSecond = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    const legalRowsAfterSecond = afterSecond.filter((r) => r.domain === "legal");
    expect(legalRowsAfterSecond).toHaveLength(1); // still exactly one row, not two
    expect(legalRowsAfterSecond[0]!.id).toBe(legalRowsAfterFirst[0]!.id); // same row, not replaced
  });

  it("isolates a per-domain failure: one failed domain leaves the others drafted", async () => {
    const { initiativeId, cycleId } = await setUpChampionInReview(db);
    const domains = ["legal", "security", "responsible-ai"] as const;
    const failingPort = portFailingFor(["security"]);

    const result = await startDraftRun(db, initiativeId, [...domains], failingPort);

    const byDomain = new Map(result.outcomes.map((o) => [o.domain, o]));
    expect(byDomain.get("legal")?.status).toBe("drafted");
    expect(byDomain.get("responsible-ai")?.status).toBe("drafted");
    expect(byDomain.get("security")?.status).toBe("failed");

    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    const securityRow = rows.find((r) => r.domain === "security")!;
    const legalRow = rows.find((r) => r.domain === "legal")!;
    expect(securityRow.status).toBe("pending"); // stays pending, not drafted
    expect(securityRow.returnReason).toMatch(/simulated failure/);
    expect(legalRow.status).toBe("drafted");
  });

  it("isolates a rejected promise the same way as an error PortResult", async () => {
    const { initiativeId, cycleId } = await setUpChampionInReview(db);
    const domains = ["legal", "data-governance"] as const;
    const failingPort = portFailingFor(["data-governance"], "reject");

    const result = await startDraftRun(db, initiativeId, [...domains], failingPort);
    const byDomain = new Map(result.outcomes.map((o) => [o.domain, o]));
    expect(byDomain.get("data-governance")?.status).toBe("failed");
    expect(byDomain.get("legal")?.status).toBe("drafted");

    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    const dgRow = rows.find((r) => r.domain === "data-governance")!;
    expect(dgRow.status).toBe("pending");
  });

  it("a failed domain can be retried by re-invoking startDraftRun (resumable)", async () => {
    const { initiativeId, cycleId } = await setUpChampionInReview(db);
    const domains = ["security"] as const;
    const failingPort = portFailingFor(["security"]);

    const first = await startDraftRun(db, initiativeId, [...domains], failingPort);
    expect(first.outcomes[0]!.status).toBe("failed");

    // Retry with a healthy port: since the row is still 'pending' (not drafted), it re-attempts.
    const healthyPort = createMockAgentPort();
    const second = await startDraftRun(db, initiativeId, [...domains], healthyPort);
    expect(second.outcomes[0]!.status).toBe("drafted");

    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    expect(rows.filter((r) => r.domain === "security")).toHaveLength(1);
    expect(rows.find((r) => r.domain === "security")!.status).toBe("drafted");
  });

  it("idempotency/resumability hold with a custom concurrency: already-drafted domains are skipped on re-run", async () => {
    const { initiativeId, cycleId } = await setUpChampionInReview(db);
    const domains = ["legal", "security", "responsible-ai"] as const;

    const first = await startDraftRun(db, initiativeId, [...domains], undefined, { concurrency: 1 });
    expect(first.outcomes.every((o) => o.status === "drafted")).toBe(true);

    const second = await startDraftRun(db, initiativeId, [...domains], undefined, { concurrency: 1 });
    expect(second.outcomes.every((o) => o.status === "skipped")).toBe(true);

    const rows = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycleId));
    for (const domain of domains) {
      expect(rows.filter((r) => r.domain === domain)).toHaveLength(1); // still exactly one row each
    }
  });

  describe("bounded concurrency", () => {
    it("with concurrency: 1, draftReview calls are serialized and all domains still complete", async () => {
      const { initiativeId, cycleId } = await setUpChampionInReview(db);
      const domains = ["legal", "security", "responsible-ai", "privacy-hipaa"] as const;
      const { port, maxObservedConcurrent } = portRecordingConcurrency(20);

      const result = await startDraftRun(db, initiativeId, [...domains], port, { concurrency: 1 });

      expect(result.outcomes).toHaveLength(4);
      expect(result.outcomes.every((o) => o.status === "drafted")).toBe(true);
      expect(maxObservedConcurrent()).toBe(1);

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, cycleId));
      const drafted = rows.filter((r) => domains.includes(r.domain as (typeof domains)[number]));
      expect(drafted.every((r) => r.status === "drafted")).toBe(true);
    });

    it("never runs more than `concurrency` draftReview calls at once", async () => {
      const { initiativeId } = await setUpChampionInReview(db);
      const domains = ["legal", "security", "responsible-ai", "privacy-hipaa", "clinical-safety"] as const;
      const { port, maxObservedConcurrent } = portRecordingConcurrency(20);

      const result = await startDraftRun(db, initiativeId, [...domains], port, { concurrency: 2 });

      expect(result.outcomes.every((o) => o.status === "drafted")).toBe(true);
      expect(maxObservedConcurrent()).toBeLessThanOrEqual(2);
    });
  });

  describe("retry", () => {
    it("a domain that fails on its first attempt but succeeds on retry ends drafted", async () => {
      const { initiativeId, cycleId } = await setUpChampionInReview(db);
      const domains = ["legal", "security"] as const;
      const flakyPort = portFailingNTimesThenSucceeding(["security"], 1);

      const result = await startDraftRun(db, initiativeId, [...domains], flakyPort);

      const byDomain = new Map(result.outcomes.map((o) => [o.domain, o]));
      expect(byDomain.get("security")?.status).toBe("drafted");
      expect(byDomain.get("legal")?.status).toBe("drafted");

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, cycleId));
      const securityRows = rows.filter((r) => r.domain === "security");
      expect(securityRows).toHaveLength(1); // exactly one row despite the retry
      expect(securityRows[0]!.status).toBe("drafted");
    });

    it("a domain that fails every attempt is recorded failed without blocking others", async () => {
      const { initiativeId, cycleId } = await setUpChampionInReview(db);
      const domains = ["legal", "security"] as const;
      // Always fails "security" — exceeds default maxAttempts (2), so every retry is exhausted.
      const alwaysFailingPort = portFailingFor(["security"]);

      const result = await startDraftRun(db, initiativeId, [...domains], alwaysFailingPort);

      const byDomain = new Map(result.outcomes.map((o) => [o.domain, o]));
      expect(byDomain.get("security")?.status).toBe("failed");
      expect(byDomain.get("legal")?.status).toBe("drafted");

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, cycleId));
      const securityRows = rows.filter((r) => r.domain === "security");
      expect(securityRows).toHaveLength(1); // still exactly one row, not one per attempt
      expect(securityRows[0]!.status).toBe("pending");
      expect(securityRows[0]!.returnReason).toMatch(/simulated failure/);
    });

    it("respects a custom maxAttempts: fails permanently if retries are exhausted before success", async () => {
      const { initiativeId } = await setUpChampionInReview(db);
      const domains = ["security"] as const;
      // Fails twice before succeeding, but maxAttempts is only 2 (1 retry) — should stay failed.
      const flakyPort = portFailingNTimesThenSucceeding(["security"], 2);

      const result = await startDraftRun(db, initiativeId, [...domains], flakyPort, { maxAttempts: 2 });
      expect(result.outcomes[0]!.status).toBe("failed");
    });

    it("does not retry a validation failure (permanent, not transient)", async () => {
      const { initiativeId, cycleId } = await setUpChampionInReview(db);
      const domains = ["security"] as const;
      let callCount = 0;
      const base = createMockAgentPort();
      const validationFailingPort: AgentPort = {
        ...base,
        async draftReview(input: DraftReviewInput): Promise<PortResult<DraftReviewOutput>> {
          void input;
          callCount++;
          return { ok: false, error: { kind: "validation", message: "bad intake payload" } };
        },
      };

      const result = await startDraftRun(db, initiativeId, [...domains], validationFailingPort);

      expect(result.outcomes[0]!.status).toBe("failed");
      expect(callCount).toBe(1); // never retried

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, cycleId));
      expect(rows.find((r) => r.domain === "security")!.returnReason).toMatch(/bad intake payload/);
    });
  });

  describe("runSingleDomainDraft (on-demand single-domain re-draft)", () => {
    it("drafts a single pending domain and persists it drafted", async () => {
      const { cycleId } = await setUpChampionInReview(db);

      const result = await runSingleDomainDraft(db, cycleId, "clinical-safety", createMockAgentPort());

      expect(result.status).toBe("drafted");
      expect(result.draftMd).toBeTruthy();

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety")));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("drafted");
      expect(rows[0]!.draftMd).toBeTruthy();
    });

    it("re-runs an ALREADY-drafted domain (unlike startDraftRun, which skips it)", async () => {
      const { cycleId } = await setUpChampionInReview(db);

      await runSingleDomainDraft(db, cycleId, "clinical-safety", createMockAgentPort());
      // Second explicit run must re-attempt (not skip) and keep exactly one row.
      const second = await runSingleDomainDraft(db, cycleId, "clinical-safety", createMockAgentPort());
      expect(second.status).toBe("drafted");
      expect(second.draftMd).toBeTruthy();

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety")));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("drafted");
    });

    it("records a failed run as pending with the reason, without a duplicate row", async () => {
      const { cycleId } = await setUpChampionInReview(db);
      const failingPort = portFailingFor(["clinical-safety"]);

      const result = await runSingleDomainDraft(db, cycleId, "clinical-safety", failingPort);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/simulated failure/);

      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety")));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.returnReason).toMatch(/simulated failure/);
    });

    it("refuses to overwrite a signed review (backstop)", async () => {
      const { cycleId } = await setUpChampionInReview(db);
      // Force the row to 'signed' directly (bypassing sign authz for the test).
      await runSingleDomainDraft(db, cycleId, "clinical-safety", createMockAgentPort());
      await db
        .update(reviewDecisions)
        .set({ status: "signed" })
        .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety")));

      await expect(
        runSingleDomainDraft(db, cycleId, "clinical-safety", createMockAgentPort()),
      ).rejects.toThrow(/signed/i);
    });

    it("throws for an unknown cycle", async () => {
      await expect(
        runSingleDomainDraft(db, "cycle-does-not-exist", "legal", createMockAgentPort()),
      ).rejects.toThrow(/no review cycle/i);
    });
  });

  describe("getRunProgress", () => {
    it("reports per-domain status for UI polling", async () => {
      const { initiativeId, cycleId, domains } = await setUpChampionInReview(db);
      await startDraftRun(db, initiativeId, ["legal", "security"]);

      const progress = await getRunProgress(db, cycleId);
      expect(progress.rows).toHaveLength(domains.length);
      const legal = progress.rows.find((r) => r.domain === "legal")!;
      expect(legal.status).toBe("drafted");
      expect(progress.complete).toBe(false); // not all 8 domains drafted yet
    });
  });
});
