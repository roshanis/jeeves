import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort, DraftReviewOutput, PortResult } from "../agents/ports";
import { reviewDecisions } from "../db/schema";
import * as svc from "../services/initiative-service";
import { runSingleDomainDraft } from "./review-run";

const REQUESTER = { id: "priya-raman", role: "requester" as const };
const REVIEWER = { id: "elena-vasquez", role: "reviewer" as const };
const DOMAIN = "clinical-safety";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function controlledPort() {
  const entered = deferred<void>();
  const result = deferred<PortResult<DraftReviewOutput>>();
  const port: AgentPort = { ...createMockAgentPort(), draftReview: async () => { entered.resolve(); return result.promise; } };
  return { port, entered: entered.promise, finish: result.resolve };
}
function draft(text: string): PortResult<DraftReviewOutput> {
  return { ok: true, value: { domain: DOMAIN, draftMarkdown: text, recommendation: "recommend-sign-off", suggestedConditions: [], missingEvidence: ["Missing evidence is not a citation"], citations: ["POL-CLIN-001"] } };
}

describe("review integrity regression", () => {
  let db: TestDb;
  let initiativeId: string;
  let cycleId: string;
  beforeEach(async () => {
    db = await createTestDb();
    ({ initiativeId } = await svc.createDraft(db, { payload: CHAMPION_PREFILL_PAYLOAD, requesterActor: REQUESTER, requesterName: "Priya Raman" }));
    await svc.submitIntake(db, initiativeId, REQUESTER);
    const result = await svc.triage(db, initiativeId);
    if (result.branch !== "review") throw new Error("review branch required");
    cycleId = result.cycleId;
  });
  afterEach(async () => { await closeTestDb(db); });
  async function row() {
    return (await db.select().from(reviewDecisions).where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, DOMAIN))))[0]!;
  }

  it.each(["success", "failure"])("an older %s cannot replace a newer accepted draft", async (mode) => {
    const old = controlledPort();
    const pending = runSingleDomainDraft(db, cycleId, DOMAIN, old.port, { maxAttempts: 1 });
    await old.entered;
    await db.update(reviewDecisions).set({ activeAttemptExpiresAt: new Date(0) }).where(eq(reviewDecisions.cycleId, cycleId));
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...createMockAgentPort(), draftReview: async () => draft("New draft") });
    old.finish(mode === "success" ? draft("Old draft") : { ok: false, error: { kind: "provider", message: "old failure", retryable: false } });
    expect((await pending).status).toBe("skipped");
    expect(await row()).toMatchObject({ status: "drafted", draftMd: "New draft", returnReason: null });
  });

  it("a newer identical draft still supersedes an older invocation", async () => {
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...createMockAgentPort(), draftReview: async () => draft("Same draft") });
    const old = controlledPort();
    const pending = runSingleDomainDraft(db, cycleId, DOMAIN, old.port);
    await old.entered;
    await db.update(reviewDecisions).set({ activeAttemptExpiresAt: new Date(0) }).where(eq(reviewDecisions.cycleId, cycleId));
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...createMockAgentPort(), draftReview: async () => draft("Same draft") });
    old.finish(draft("Stale replacement"));
    expect(await pending).toMatchObject({ status: "skipped", reason: "superseded" });
    expect((await row()).draftMd).toBe("Same draft");
  });

  it("repeating the same human return also invalidates an earlier draft", async () => {
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "More evidence", (await row()).revision);
    const old = controlledPort();
    const pending = svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, old.port);
    await old.entered;
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "More evidence", (await row()).revision);
    old.finish(draft("Late draft"));
    expect((await pending).status).toBe("skipped");
    expect(await row()).toMatchObject({ status: "returned", returnReason: "More evidence" });
  });

  it("a failed explicit redraft preserves the earlier human return and reason", async () => {
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "Attach clinical evidence", (await row()).revision);
    const before = await row();
    const result = await svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, {
      ...createMockAgentPort(), draftReview: async () => ({ ok: false, error: { kind: "provider", message: "Unavailable", retryable: false } }),
    });
    expect(result.status).toBe("failed");
    expect(await row()).toMatchObject({ status: before.status, returnReason: before.returnReason, draftMd: before.draftMd, reviewer: before.reviewer, revision: before.revision + 1, activeAttemptId: null, activeAttemptExpiresAt: null });
  });

});
