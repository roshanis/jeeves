import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, controlDefinitions, initiatives, initiativeDecisions, reviewCycles, reviewDecisions } from "../db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { DraftReviewOutput, PortResult } from "../agents/ports";
import { DbDataProvider } from "../data/db-provider";
import { runSingleDomainDraft, startDraftRun } from "../workflow/review-run";
import { reviewDecisionReadiness } from "../approval/review-readiness";
import * as svc from "./initiative-service";
import { ACTOR_DIRECTORY, reviewerDomainFor } from "./actors";
import { CONTROL_SEEDS } from "../../scripts/seed";

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
    await db.insert(controlDefinitions).values(CONTROL_SEEDS.map(control => ({ ...control })));
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

  const approver = { id: "angela-torres", role: "approver" as const };
  async function abstainAll() {
    const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
    for (const review of rows) {
      const actor = Object.values(ACTOR_DIRECTORY).find(actor => reviewerDomainFor(actor.id) === review.domain)!;
      await svc.abstainReview(db, cycleId, review.domain as Parameters<typeof svc.abstainReview>[2], { id: actor.id, role: "reviewer" }, workspace, reason, review.revision);
    }
  }

  it.each(["approved", "conditionally_approved", "rejected"] as const)("records an explicit %s conclusion with an abstained reviewer", async (decision) => {
    await db.update(reviewDecisions).set({ status: "signed", draftMd: "Signed assessment" }).where(eq(reviewDecisions.cycleId, cycleId));
    await db.update(reviewDecisions).set({ status: "drafted" }).where(eq(reviewDecisions.id, (await row()).id));
    await abstain();
    const before = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(before?.summary).toMatchObject({ domainsSigned: 7, domainsAbstained: 1, decisionReadiness: { canApprove: true, canConditionallyApprove: true } });
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    await svc.decide(db, initiativeId, approver, workspace, { decision, conditions: [{ text: "Pilot controls", controlId: "H-01" }] });
    expect((await db.select().from(initiatives))[0]).toMatchObject({ state: decision, accountableApprover: approver.id });
    expect((await db.select().from(reviewCycles))[0].closedAt).not.toBeNull();
    const event = (await db.select().from(auditEvents)).find(event => event.metadata?.reviewSnapshots);
    const snapshots = event?.metadata?.reviewSnapshots as Record<string, unknown>[];
    expect(snapshots.find(snapshot => snapshot.domain === domain)).toMatchObject({
      status: "abstained", signatureEventId: null, provenance: "abstention-receipt",
      abstention: { reason, reviewer: reviewer.id, eventId: expect.any(String) },
    });
    await expect(svc.resumeReview(db, cycleId, domain, reviewer, workspace, 1)).rejects.toThrow(svc.ConflictError);
    expect((await row()).status).toBe("abstained");
    const after = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(after?.reviews.find(review => review.domain === domain)).toMatchObject({ cycleOpen: false });
    expect(after?.summary.domainsSigned).toBe(7);
  });

  it.each(["approved", "conditionally_approved"] as const)("permits %s with zero signatures only after all reviewers abstain and an approver acts", async (decision) => {
    await abstainAll();
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    expect((await db.select().from(initiatives))[0].state).toBe("in_review");
    for (const actor of [requester, reviewer, { id: "ray-chen", role: "admin" as const }]) {
      await expect(svc.decide(db, initiativeId, actor, workspace, { decision, conditions: [{ text: "Pilot controls", controlId: "H-01" }] })).rejects.toThrow(svc.IllegalTransitionError);
    }
    await svc.decide(db, initiativeId, approver, workspace, { decision, conditions: [{ text: "Pilot controls", controlId: "H-01" }] });
    const detail = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(detail?.summary).toMatchObject({ state: decision, domainsRequired: 8, domainsSigned: 0, domainsAbstained: 8 });
    expect(detail?.controls.length).toBeGreaterThan(0);
    expect(detail?.controls.some(control => control.status !== "met")).toBe(true);
    expect(detail?.reviews.every(review => review.status === "abstained" && review.signedAt === null)).toBe(true);
  });

  it("restores the participation requirement when a reviewer resumes before a decision", async () => {
    await abstainAll();
    await svc.resumeReview(db, cycleId, domain, reviewer, workspace, 1);
    await expect(svc.decide(db, initiativeId, approver, workspace, { decision: "approved" })).rejects.toThrow(/clinical-safety:pending/);
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    const detail = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(detail?.summary).toMatchObject({ domainsAbstained: 7, decisionReadiness: { canApprove: false, canConditionallyApprove: false } });
  });

  it.each(["missing", "stale", "duplicate", "blank reason"])("keeps a %s abstention receipt blocking in both server and read model", async (corruption) => {
    await abstainAll();
    const review = await row();
    if (corruption === "stale") await db.update(reviewDecisions).set({ revision: 2 }).where(eq(reviewDecisions.id, review.id));
    else {
      // The production audit is append-only: simulate corruption with an extra receipt, or an unreceipted row revision.
      const original = (await db.select().from(auditEvents)).find(event => event.metadata?.reviewDecisionId === review.id)!;
      if (corruption === "missing") await db.update(reviewDecisions).set({ id: "unreceipted-review" }).where(eq(reviewDecisions.id, review.id));
      else {
        if (corruption === "blank reason") await db.update(reviewDecisions).set({ revision: 2 }).where(eq(reviewDecisions.id, review.id));
        await db.insert(auditEvents).values({ ...original, id: `extra-${corruption}`, metadata: { ...original.metadata, ...(corruption === "blank reason" ? { reason: " ", revision: 2 } : {}) } });
      }
    }
    for (const decision of ["approved", "conditionally_approved"] as const) {
      await expect(svc.decide(db, initiativeId, approver, workspace, { decision, conditions: [{ text: "Pilot controls", controlId: "H-01" }] })).rejects.toThrow(/abstained/);
    }
    const detail = await new DbDataProvider(db).getInitiativeDetail(slug, { viewerWorkspaceId: workspace });
    expect(detail?.summary.decisionReadiness).toMatchObject({ canApprove: false, canConditionallyApprove: false });
    expect(await db.select().from(initiativeDecisions)).toHaveLength(0);
    expect((await db.select().from(reviewCycles))[0].closedAt).toBeNull();
  });
});
