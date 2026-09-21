// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as agents from "../agents";
import * as corpus from "../agents/policy-corpus";
import { AgentInitializationError } from "../agents/initialization-error";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort } from "../agents/ports";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, initiatives, intakeVersions, reviewCycles, reviewDecisions, riskAssessments, runBudget } from "../db/schema";
import { runSingleDomainDraft, startDraftRun } from "./review-run";

let db: TestDb;
const at = new Date("2026-09-19T10:00:00Z");
const budget = { day: "2026-09-19", dailyCap: 500_000, tokensPerAttempt: 1_500 };
const options = { budget, sessionWorkspaceId: "workspace-a", retryDelayMs: 0 };
const priorDraft = "The existing assessment remains available for human review.";

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(initiatives).values({ id: "i", slug: "initialization-fixture", title: "Fictional review", requester: "Priya Raman", state: "in_review", workspaceId: "workspace-a", createdAt: at, updatedAt: at });
  await db.insert(intakeVersions).values({ id: "iv", initiativeId: "i", version: 1, submitted: true, fields: { useCase: "Synthetic test" }, createdAt: at });
  await db.insert(riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "iv", tier: "high", flags: {}, requiredDomains: ["legal"], createdAt: at });
  await db.insert(reviewCycles).values({ id: "cycle", initiativeId: "i", kind: "initial", riskAssessmentId: "risk", openedAt: at });
  await db.insert(reviewDecisions).values({ id: "review", cycleId: "cycle", domain: "legal", status: "pending", revision: 4, draftMd: priorDraft, createdAt: at });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeTestDb(db);
});

async function review() {
  return (await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, "review")))[0]!;
}

async function expectNoReservation() {
  expect(await db.select().from(runBudget)).toEqual([]);
  expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "draft_budget_reserved"))).toEqual([]);
}

async function expectPreservedReview() {
  expect(await review()).toMatchObject({ draftMd: priorDraft, revision: 4, activeAttemptId: null, activeAttemptExpiresAt: null });
}

describe("workflow initialization failures", () => {
  it.each(["single", "fan-out"] as const)("preserves typed factory failure through the %s workflow without a reservation or stranded claim", async (mode) => {
    if (mode === "single") await db.update(reviewDecisions).set({ status: "drafted" }).where(eq(reviewDecisions.id, "review"));
    const failure = new AgentInitializationError(new Error("synthetic internal prompt path"));
    const factory = vi.spyOn(agents, "getAgentPort").mockImplementation(() => { throw failure; });
    const run = mode === "single"
      ? runSingleDomainDraft(db, "cycle", "legal", undefined, options)
      : startDraftRun(db, "i", ["legal"], undefined, options);
    await expect(run).rejects.toBe(failure);
    expect(factory).toHaveBeenCalledOnce();
    await expectNoReservation();
    await expectPreservedReview();
    expect((await review()).status).toBe(mode === "single" ? "drafted" : "pending");
  });

  it("classifies an unavailable required policy before claiming work or reserving capacity", async () => {
    const factory = vi.spyOn(agents, "getAgentPort");
    vi.spyOn(corpus, "readPolicyFileSafe").mockImplementation(() => { throw new Error("synthetic missing policy path"); });
    await expect(startDraftRun(db, "i", ["legal"], undefined, options)).rejects.toBeInstanceOf(AgentInitializationError);
    expect(factory).not.toHaveBeenCalled();
    await expectNoReservation();
    await expectPreservedReview();
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "draft_attempt_started"))).toEqual([]);
  });

  it("releases its claim if policy assets disappear before persistence while retaining the dispatched reservation", async () => {
    const base = createMockAgentPort();
    const draftReview = vi.fn<AgentPort["draftReview"]>().mockImplementation(async (input) => {
      const result = await base.draftReview(input);
      vi.spyOn(corpus, "readPolicyFileSafe").mockImplementation(() => { throw new Error("synthetic missing policy after dispatch"); });
      return result;
    });
    await expect(runSingleDomainDraft(db, "cycle", "legal", { ...base, draftReview }, options)).rejects.toBeInstanceOf(AgentInitializationError);
    expect(draftReview).toHaveBeenCalledOnce();
    await expectPreservedReview();
    expect(await db.select().from(runBudget)).toMatchObject([{ tokensUsed: 1_500 }]);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "draft_budget_reserved"))).toHaveLength(1);
  });

  it("does not clear a newer attempt that acquires ownership after failed finalization rolls back", async () => {
    const base = createMockAgentPort();
    let replaceOwner = false;
    const replacementExpiry = new Date(Date.now() + 120_000);
    const draftReview = vi.fn<AgentPort["draftReview"]>().mockImplementation(async (input) => {
      const result = await base.draftReview(input);
      vi.spyOn(corpus, "readPolicyFileSafe").mockImplementation(() => { replaceOwner = true; throw new Error("synthetic missing policy after dispatch"); });
      return result;
    });
    // Model the interleaving between finalization rollback and cleanup using
    // actual database writes; cleanup must not remove the replacement lease.
    const racedDb = new Proxy(db, { get(target, key) {
      if (key !== "transaction") {
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<TestDb["transaction"]>) => {
        try { return await target.transaction(...args); }
        catch (error) {
          if (replaceOwner) {
            replaceOwner = false;
            await db.update(reviewDecisions).set({ activeAttemptId: "replacement-attempt", activeAttemptExpiresAt: replacementExpiry }).where(eq(reviewDecisions.id, "review"));
          }
          throw error;
        }
      };
    } });
    await expect(runSingleDomainDraft(racedDb, "cycle", "legal", { ...base, draftReview }, options)).rejects.toBeInstanceOf(AgentInitializationError);
    expect(await review()).toMatchObject({ draftMd: priorDraft, revision: 4, activeAttemptId: "replacement-attempt", activeAttemptExpiresAt: replacementExpiry });
    expect(await db.select().from(runBudget)).toMatchObject([{ tokensUsed: 1_500 }]);
  });
});
