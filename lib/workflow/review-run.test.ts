import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort, DraftReviewInput, PortResult, DraftReviewOutput } from "../agents/ports";
import { reviewDecisions } from "../db/schema";
import { eq } from "drizzle-orm";
import * as svc from "../services/initiative-service";
import { getRunProgress, startDraftRun } from "./review-run";

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
