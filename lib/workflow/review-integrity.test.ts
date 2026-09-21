import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort, DraftReviewOutput, PortResult } from "../agents/ports";
import { auditEvents, intakeVersions, reviewCycles, reviewDecisions } from "../db/schema";
import * as svc from "../services/initiative-service";
import { runSingleDomainDraft, startDraftRun } from "./review-run";
import { reviewDraftToken } from "./review-draft-token";

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
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...createMockAgentPort(), draftReview: async () => draft("Same draft") });
    old.finish(draft("Stale replacement"));
    expect(await pending).toMatchObject({ status: "skipped", reason: "superseded" });
    expect((await row()).draftMd).toBe("Same draft");
  });

  it("repeating the same human return also invalidates an earlier draft", async () => {
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "More evidence");
    const old = controlledPort();
    const pending = svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, old.port);
    await old.entered;
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "More evidence");
    old.finish(draft("Late draft"));
    expect((await pending).status).toBe("skipped");
    expect(await row()).toMatchObject({ status: "returned", returnReason: "More evidence" });
  });

  it("a human return during drafting preserves its reason", async () => {
    const old = controlledPort();
    const pending = svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, old.port);
    await old.entered;
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "Evidence is missing");
    old.finish(draft("Late draft"));
    expect((await pending).status).toBe("skipped");
    expect(await row()).toMatchObject({ status: "returned", returnReason: "Evidence is missing", reviewer: REVIEWER.id });
  });

  it("closed cycles reject returns, signs and drafts before provider invocation", async () => {
    await db.update(reviewDecisions).set({ status: "drafted", draftMd: "Reviewed" }).where(eq(reviewDecisions.cycleId, cycleId));
    await db.update(reviewCycles).set({ closedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    await expect(svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "Late return")).rejects.toThrow(/closed/i);
    await expect(svc.signReview(db, cycleId, DOMAIN, REVIEWER, null)).rejects.toThrow(/closed/i);
    await expect(svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, createMockAgentPort())).rejects.toThrow(/closed/i);
    await expect(startDraftRun(db, initiativeId, [DOMAIN], createMockAgentPort())).rejects.toThrow(/closed/i);
  });

  it("a cycle closed during an invocation rejects the late draft", async () => {
    const old = controlledPort();
    const pending = runSingleDomainDraft(db, cycleId, DOMAIN, old.port);
    await old.entered;
    await db.update(reviewCycles).set({ closedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    old.finish(draft("Late draft"));
    expect((await pending).status).toBe("skipped");
    expect((await row()).status).toBe("pending");
  });

  it("uses the intake version bound to the cycle assessment", async () => {
    const [original] = await db.select().from(intakeVersions).where(eq(intakeVersions.initiativeId, initiativeId));
    await db.insert(intakeVersions).values({ ...original!, id: "unrelated-later-intake", version: 2, fields: { unrelated: "later draft" } });
    let seen: string | undefined;
    const base = createMockAgentPort();
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...base, draftReview: async (input) => { seen = input.intake.intakeVersionId; return base.draftReview(input); } });
    expect(seen).toBe(original!.id);
  });

  it("persists policy citations separately from missing evidence", async () => {
    await runSingleDomainDraft(db, cycleId, DOMAIN, { ...createMockAgentPort(), draftReview: async () => draft("Draft with gaps") });
    expect((await row()).citations).toEqual(["POL-CLIN-001"]);
  });

  it("deduplicates requested domains before invoking", async () => {
    let calls = 0;
    await startDraftRun(db, initiativeId, [DOMAIN, DOMAIN], { ...createMockAgentPort(), draftReview: async () => { calls++; return draft("Draft"); } });
    expect(calls).toBe(1);
  });

  it("rolls back persisted draft when actor attribution receipt fails", async () => {
    await db.$client.exec(`CREATE FUNCTION fail_review_receipt() RETURNS trigger AS $$ BEGIN IF NEW.action = 'review_agent_run' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER fail_review_receipt BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_review_receipt();`);
    const before = await row();
    await expect(svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, createMockAgentPort())).rejects.toThrow();
    expect(await row()).toEqual(before);
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "review_agent_run")))).toHaveLength(0);
  });

  it("a failed explicit redraft preserves the earlier human return and reason", async () => {
    await svc.returnReview(db, cycleId, DOMAIN, REVIEWER, null, "Attach clinical evidence");
    const before = await row();
    const result = await svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, {
      ...createMockAgentPort(), draftReview: async () => ({ ok: false, error: { kind: "provider", message: "Unavailable", retryable: false } }),
    });
    expect(result.status).toBe("failed");
    expect(await row()).toEqual(before);
  });

  it("passes the caller signal and a bounded shared deadline, without retrying timeouts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await svc.runReviewAgent(db, cycleId, DOMAIN, REVIEWER, null, {
      ...createMockAgentPort(),
      draftReview: async (_input, options) => {
        calls++;
        expect(options?.signal).toBe(controller.signal);
        expect(options?.timeoutMs).toBeGreaterThan(0);
        expect(options?.timeoutMs).toBeLessThanOrEqual(1000);
        return { ok: false, error: { kind: "timeout", elapsedMs: 1000, message: "Draft deadline exceeded" } };
      },
    }, { signal: controller.signal, timeoutMs: 1000 });
    expect(result.status).toBe("failed");
    expect(calls).toBe(1);
  });

  it("accepts a current content token and binds reviewer edits to that snapshot", async () => {
    await runSingleDomainDraft(db, cycleId, DOMAIN, createMockAgentPort());
    const token = reviewDraftToken(await row());
    await svc.signReview(db, cycleId, DOMAIN, REVIEWER, null, "Reviewer edit", token);
    expect(await row()).toMatchObject({ status: "signed", draftMd: "Reviewer edit" });
  });

  it("rejects a stale draft token even when the review is still drafted", async () => {
    await db.update(reviewDecisions).set({ status: "drafted", draftMd: "Unseen replacement" }).where(eq(reviewDecisions.cycleId, cycleId));
    await expect(svc.signReview(db, cycleId, DOMAIN, REVIEWER, null, undefined, "stale-draft-token")).rejects.toThrow(/changed|stale/i);
    expect((await row()).status).toBe("drafted");
  });
});
