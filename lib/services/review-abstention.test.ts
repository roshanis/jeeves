import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, initiatives, initiativeDecisions, reviewCycles, reviewDecisions } from "../db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { DraftReviewOutput, PortResult } from "../agents/ports";
import { DbDataProvider } from "../data/db-provider";
import { runSingleDomainDraft, startDraftRun } from "../workflow/review-run";
import { reviewDecisionReadiness } from "../approval/review-readiness";
import * as svc from "./initiative-service";

const requester = { id: "priya-raman", role: "requester" as const };
const reviewer = { id: "elena-vasquez", role: "reviewer" as const };
const domain = "clinical-safety";
const workspace = "abstention-test-workspace";
const reason = "I helped design this proposal and cannot independently review it.";

describe("domain reviewer abstention", () => {
  let db: TestDb;
  let initiativeId: string;
  let slug: string;
  let cycleId: string;
  beforeEach(async () => {
    db = await createTestDb();
    ({ initiativeId, slug } = await svc.createDraft(db, { payload: CHAMPION_PREFILL_PAYLOAD, requesterActor: requester, requesterName: "Priya Raman", workspaceId: workspace }));
    await svc.submitIntake(db, initiativeId, requester, workspace);
    const result = await svc.triage(db, initiativeId, undefined, workspace);
    if (result.branch !== "review") throw new Error("Review cycle required");
    cycleId = result.cycleId;
  });
  afterEach(async () => { await closeTestDb(db); });
  async function row() {
    return (await db.select().from(reviewDecisions).where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain))))[0]!;
  }
  const abstain = (revision = 0) => svc.abstainReview(db, cycleId, domain, reviewer, workspace, reason, revision);

  it.each(["pending", "drafted", "returned"])("records and resumes the exact prior %s state without resolving the initiative", async (status) => {
    await db.update(reviewDecisions).set({ status, draftMd: "Preserved assessment", returnReason: status === "returned" ? "Need revised evidence" : null })
      .where(eq(reviewDecisions.cycleId, cycleId));
    const before = await row();
    await abstain();
    expect(await row()).toMatchObject({ status: "abstained", reviewer: reviewer.id, revision: 1, draftMd: before.draftMd, returnReason: before.returnReason, activeAttemptId: null });
    const [event] = (await db.select().from(auditEvents)).filter((event) => event.action === "review_abstained");
    expect(event).toMatchObject({ actor: reviewer.id, actorRole: "reviewer", before: status, after: "abstained", metadata: { cycleId, domain, reviewDecisionId: before.id, revision: 1, reason } });
    expect((await db.select().from(initiatives))[0]?.state).toBe("in_review");
    expect((await db.select().from(reviewCycles))[0]?.closedAt).toBeNull();
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    const detail = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(detail?.reviews.find((r) => r.domain === domain)).toMatchObject({ status: "abstained", abstention: { reason, reviewer: reviewer.id, at: event.ts.toISOString() } });
    expect(reviewDecisionReadiness({ state: "in_review", cycleOpen: true, requiredDomains: [domain], reviews: [await row()] })).toMatchObject({ canApprove: false, canConditionallyApprove: false });
    await svc.resumeReview(db, cycleId, domain, reviewer, workspace, 1);
    expect(await row()).toMatchObject({ status, revision: 2, draftMd: before.draftMd, returnReason: before.returnReason });
    const history = await db.select().from(auditEvents);
    expect(history.filter((event) => event.action === "review_abstained")).toHaveLength(1);
    expect(history.filter((event) => event.action === "review_resumed")).toHaveLength(1);
  });

  it.each(["", "  ", "x".repeat(2001)])("rejects an invalid reason without changing the review", async (invalid) => {
    await expect(svc.abstainReview(db, cycleId, domain, reviewer, workspace, invalid, 0)).rejects.toThrow(svc.ValidationError);
    expect(await row()).toMatchObject({ status: "pending", revision: 0 });
  });

  it("rejects other roles, other domains, foreign/shared workspaces and stale revisions", async () => {
    for (const actor of [requester, { id: "angela-torres", role: "approver" as const }, { id: "ray-chen", role: "admin" as const }, { id: "marcus-webb", role: "reviewer" as const }]) {
      await expect(svc.abstainReview(db, cycleId, domain, actor, workspace, reason, 0)).rejects.toThrow(svc.IllegalTransitionError);
    }
    for (const scope of ["other-workspace", null]) {
      await expect(svc.abstainReview(db, cycleId, domain, reviewer, scope, reason, 0)).rejects.toThrow(svc.NotFoundError);
    }
    await expect(abstain(9)).rejects.toThrow(svc.ConflictError);
    await db.update(initiatives).set({ workspaceId: null }).where(eq(initiatives.id, initiativeId));
    await expect(abstain()).rejects.toThrow(svc.NotFoundError);
  });

  it.each(["signed", "closed"])("does not abstain from a %s review", async (state) => {
    if (state === "signed") await db.update(reviewDecisions).set({ status: "signed", signedAt: new Date(), signatureEventId: "preserved-receipt" }).where(eq(reviewDecisions.cycleId, cycleId));
    else await db.update(reviewCycles).set({ closedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    await expect(abstain()).rejects.toThrow();
    expect((await row()).revision).toBe(0);
  });

  it("does not duplicate abstentions, resume missing receipts, or let sign/return bypass resumption", async () => {
    await abstain();
    await expect(abstain()).rejects.toThrow(svc.ConflictError);
    await expect(abstain(1)).rejects.toThrow(svc.ConflictError);
    await expect(svc.signReview(db, cycleId, domain, reviewer, workspace, { expectedRevision: 1, expectedEvidencePacketId: null, editedDraftMd: "Bypass attempt" })).rejects.toThrow(/resume/i);
    await expect(svc.returnReview(db, cycleId, domain, reviewer, workspace, "Bypass attempt", 1)).rejects.toThrow(/resume/i);
    // A row without an exact current-revision receipt must not be guessed back into an accepted state.
    await db.update(reviewDecisions).set({ revision: 2 }).where(eq(reviewDecisions.cycleId, cycleId));
    await expect(svc.resumeReview(db, cycleId, domain, reviewer, workspace, 2)).rejects.toThrow(svc.ConflictError);
    expect((await row()).status).toBe("abstained");
    expect((await db.select().from(auditEvents)).filter((event) => event.action === "review_abstained")).toHaveLength(1);
  });

  it("skips both batch and explicit drafting without calling the model", async () => {
    await abstain();
    const port = { ...createMockAgentPort(), draftReview: vi.fn() };
    expect(await runSingleDomainDraft(db, cycleId, domain, port, { sessionWorkspaceId: workspace })).toMatchObject({ status: "skipped", reason: "reviewer abstained" });
    expect((await startDraftRun(db, initiativeId, [domain], port, { sessionWorkspaceId: workspace })).outcomes).toEqual([{ domain, status: "skipped", reason: "reviewer abstained" }]);
    expect(port.draftReview).not.toHaveBeenCalled();
  });

  it("fences an in-flight draft when its reviewer abstains", async () => {
    let entered!: () => void;
    let finish!: (result: PortResult<DraftReviewOutput>) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const response = new Promise<PortResult<DraftReviewOutput>>((resolve) => { finish = resolve; });
    const port = { ...createMockAgentPort(), draftReview: async () => { entered(); return response; } };
    const pending = runSingleDomainDraft(db, cycleId, domain, port, { sessionWorkspaceId: workspace });
    await started;
    await abstain();
    finish({ ok: true, value: { domain, draftMarkdown: "Stale draft", recommendation: "recommend-sign-off", suggestedConditions: [], missingEvidence: [], citations: [] } });
    expect(await pending).toMatchObject({ status: "skipped", reason: "superseded" });
    expect(await row()).toMatchObject({ status: "abstained", draftMd: null, revision: 1, activeAttemptId: null });
  });
  it("enforces domain, workspace, current revision and open cycle on resume", async () => {
    await abstain();
    for (const actor of [requester, {id:"angela-torres",role:"approver" as const}, {id:"marcus-webb",role:"reviewer" as const}]) {
      await expect(svc.resumeReview(db,cycleId,domain,actor,workspace,1)).rejects.toThrow(svc.IllegalTransitionError);
    }
    await expect(svc.resumeReview(db,cycleId,domain,reviewer,"foreign",1)).rejects.toThrow(svc.NotFoundError);
    await expect(svc.resumeReview(db,cycleId,domain,reviewer,workspace,0)).rejects.toThrow(svc.ConflictError);
    await db.update(reviewCycles).set({closedAt:new Date()}).where(eq(reviewCycles.id,cycleId));
    await expect(svc.resumeReview(db,cycleId,domain,reviewer,workspace,1)).rejects.toThrow(svc.ConflictError);
    expect((await row()).status).toBe("abstained");
    expect((await db.select().from(auditEvents)).filter(e=>e.action==="review_resumed")).toHaveLength(0);
  });

  it("blocks approval and conditional approval even when every other domain is signed", async () => {
    await db.update(reviewDecisions).set({status:"signed",draftMd:"Signed assessment"}).where(eq(reviewDecisions.cycleId,cycleId));
    const selected = await row();
    await db.update(reviewDecisions).set({status:"drafted"}).where(eq(reviewDecisions.id,selected.id));
    await abstain();
    for (const decision of ["approved","conditionally_approved"] as const) {
      await expect(svc.decide(db,initiativeId,{id:"angela-torres",role:"approver"},workspace,{decision,conditions:[{text:"Pilot controls",controlId:"H-01"}]})).rejects.toThrow(/abstained/);
    }
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    expect((await db.select().from(initiatives))[0].state).toBe("in_review");
    const port={...createMockAgentPort(),draftReview:vi.fn()};
    expect(await svc.runReviewAgent(db,cycleId,domain,reviewer,workspace,port,{expectedRevision:1})).toMatchObject({status:"skipped",reason:"reviewer abstained"});
    expect(port.draftReview).not.toHaveBeenCalled();
  });

});
