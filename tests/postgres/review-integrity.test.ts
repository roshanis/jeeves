import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { auditEvents, initiatives, reviewCycles, reviewDecisions } from "../../lib/db/schema";
import { createMockAgentPort } from "../../lib/agents/mock-adapter";
import type { AgentPort, DraftReviewOutput, PortResult } from "../../lib/agents/ports";
import { CHAMPION_PREFILL_PAYLOAD } from "../../lib/intake/champion-prefill";
import * as service from "../../lib/services/initiative-service";
import { runSingleDomainDraft } from "../../lib/workflow/review-run";
import { deferred, openPrivatePostgres, waitForDatabaseBlock, withDeadline, type PrivatePostgres } from "./private-postgres";

// Even an accidentally broad default Vitest include cannot connect. The
// dedicated config and helper additionally require the full explicit guard.
const postgres = process.env.JEEVES_REVIEW_TEST_PG_SOCKET ? describe : describe.skip;
const requester = { id: "priya-raman", role: "requester" as const };
const reviewer = { id: "elena-vasquez", role: "reviewer" as const };
const approver = { id: "angela-torres", role: "approver" as const };
const domain = "clinical-safety" as const;

function mockDraft(label: string, failure = false): PortResult<DraftReviewOutput> {
  return failure
    ? { ok: false, error: { kind: "provider", message: label, retryable: false } }
    : {
      ok: true,
      value: {
        domain, draftMarkdown: label, recommendation: "recommend-sign-off",
        suggestedConditions: [], missingEvidence: [], citations: ["MP-C v3 §MP-C-2"],
      },
    };
}

function gatedPort(label: string, failure = false) {
  const entered = deferred();
  const release = deferred();
  const draftReview = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return mockDraft(label, failure);
  });
  const port: AgentPort = { ...createMockAgentPort(), draftReview };
  return { port, draftReview, entered, release };
}

function immediatePort(label: string): AgentPort {
  return { ...createMockAgentPort(), draftReview: async () => mockDraft(label) };
}

postgres("real Postgres review integrity (independent connection pools)", () => {
  let db: PrivatePostgres;
  beforeAll(async () => { db = await openPrivatePostgres(); });
  afterAll(async () => { if (db) await db.close(); });

  async function fixture(drafted = false) {
    const created = await service.createDraft(db.dbA, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: requester,
      requesterName: "Priya Raman",
    });
    await service.submitIntake(db.dbA, created.initiativeId, requester);
    const triaged = await service.triage(db.dbA, created.initiativeId);
    if (triaged.branch !== "review") throw new Error("Fixture must require domain review");
    if (drafted) {
      // Set all required domains to the conditional-approval precondition.
      // Race operations below always use the real application services.
      await db.dbA.update(reviewDecisions).set({ status: "drafted", draftMd: "Original reviewed text" })
        .where(eq(reviewDecisions.cycleId, triaged.cycleId));
    }
    return { initiativeId: created.initiativeId, cycleId: triaged.cycleId };
  }

  async function review(cycleId: string) {
    const [row] = await db.dbB.select().from(reviewDecisions).where(and(
      eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain),
    ));
    if (!row) throw new Error("Missing fixture domain review");
    return row;
  }

  async function approve(dbHandle: Db, initiativeId: string) {
    return service.decide(dbHandle, initiativeId, approver, null, {
      decision: "conditionally_approved",
      conditions: [{ text: "Require human verification of every result.", controlId: "C-01" }],
    });
  }

  it("grants exactly one concurrent draft claim across separate connections", async () => {
    const { initiativeId, cycleId } = await fixture();
    const model = gatedPort("Only the winning attempt may persist");
    await db.control.query("begin");
    await db.control.query("select id from initiatives where id=$1 for update", [initiativeId]);
    const { rows: [controller] } = await db.control.query<{ pid: number }>("select pg_backend_pid() as pid");
    const runs = [
      runSingleDomainDraft(db.dbA, cycleId, domain, model.port, { maxAttempts: 1 }),
      runSingleDomainDraft(db.dbB, cycleId, domain, model.port, { maxAttempts: 1 }),
    ];
    // Observe rejection immediately too, so cleanup never creates an
    // unhandled rejection if an implementation fails before the barrier.
    const settled = runs.map((run) => run.then((result) => ({ result }), (error: unknown) => ({ error })));
    try {
      // PostgreSQL can queue the second waiter behind the first waiter's
      // tuple lock rather than directly behind the controller transaction.
      await waitForDatabaseBlock(db, db.pidA, [controller!.pid, db.pidB]);
      await waitForDatabaseBlock(db, db.pidB, [controller!.pid, db.pidA]);
      await db.control.query("commit");
      await withDeadline(model.entered.promise);
      const loser = await withDeadline(Promise.race(settled));
      expect(loser).toMatchObject({ result: { status: "skipped", reason: "already running" } });
      expect(model.draftReview).toHaveBeenCalledTimes(1);
      model.release.resolve();
      const results = await Promise.all(runs);
      expect(results.map((result) => result.status).sort()).toEqual(["drafted", "skipped"]);
      expect(await review(cycleId)).toMatchObject({
        draftMd: "Only the winning attempt may persist", status: "drafted", activeAttemptId: null,
      });
    } finally {
      await db.control.query("rollback");
      model.release.resolve();
      await Promise.allSettled(runs);
    }
  });

  it.each([false, true])("fences expired attempt completion after a new claim (failure=%s)", async (failure) => {
    const { cycleId } = await fixture(true);
    const old = gatedPort("Superseded model result", failure);
    const oldRun = runSingleDomainDraft(db.dbA, cycleId, domain, old.port, { maxAttempts: 1 });
    void oldRun.catch(() => undefined);
    try {
      await withDeadline(old.entered.promise);
      const claimed = await review(cycleId);
      expect(claimed.activeAttemptId).toBeTruthy();
      // Clock-independent crash/lease recovery: only this test-owned row's
      // lease expires. The first model call deliberately remains in flight.
      await db.dbB.update(reviewDecisions).set({ activeAttemptExpiresAt: new Date(0) })
        .where(eq(reviewDecisions.id, claimed.id));
      const current = await runSingleDomainDraft(db.dbB, cycleId, domain, immediatePort("New accepted draft"), { maxAttempts: 1 });
      expect(current.status).toBe("drafted");
      const committed = await review(cycleId);
      old.release.resolve();
      expect(await oldRun).toMatchObject({ status: "skipped", reason: "superseded" });
      expect(await review(cycleId)).toEqual(committed);
      expect(committed.draftMd).toBe("New accepted draft");
    } finally {
      old.release.resolve();
      await Promise.allSettled([oldRun]);
    }
  });

  it("preserves a human return when an older model call finishes", async () => {
    const { cycleId } = await fixture(true);
    const old = gatedPort("A stale result must not erase the return reason");
    const oldRun = runSingleDomainDraft(db.dbA, cycleId, domain, old.port, { maxAttempts: 1 });
    void oldRun.catch(() => undefined);
    try {
      await withDeadline(old.entered.promise);
      const current = await review(cycleId);
      await service.returnReview(db.dbB, cycleId, domain, reviewer, null, "Missing clinical validation evidence", current.revision);
      const returned = await review(cycleId);
      old.release.resolve();
      expect(await oldRun).toMatchObject({ status: "skipped" });
      expect(await review(cycleId)).toEqual(returned);
      expect(returned).toMatchObject({ status: "returned", returnReason: "Missing clinical validation evidence" });
    } finally {
      old.release.resolve();
      await Promise.allSettled([oldRun]);
    }
  });

  it.each(["approve", "return"] as const)("serializes approval and return when %s holds the initiative lock first", async (first) => {
    const { initiativeId, cycleId } = await fixture(true);
    const current = await review(cycleId);
    const locked = deferred();
    const release = deferred();
    const firstRun = db.dbA.transaction(async (tx) => {
      await tx.select({ id: initiatives.id }).from(initiatives).where(eq(initiatives.id, initiativeId)).for("update");
      locked.resolve();
      await release.promise;
      return first === "approve"
        ? approve(tx as unknown as Db, initiativeId)
        : service.returnReview(tx as unknown as Db, cycleId, domain, reviewer, null, "Clinical evidence needs revision", current.revision);
    });
    void firstRun.catch(() => undefined);
    let secondRun: Promise<unknown> | undefined;
    try {
      await withDeadline(locked.promise);
      secondRun = first === "approve"
        ? service.returnReview(db.dbB, cycleId, domain, reviewer, null, "Clinical evidence needs revision", current.revision)
        : approve(db.dbB, initiativeId);
      const secondSettled = secondRun.then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitForDatabaseBlock(db, db.pidB, db.pidA);
      release.resolve();
      await firstRun;
      const second = await secondSettled;
      expect(second).toHaveProperty("error");
      const [cycle] = await db.dbB.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
      const [initiative] = await db.dbB.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      if (first === "approve") {
        expect(cycle!.closedAt).not.toBeNull();
        expect(initiative!.state).toBe("conditionally_approved");
        expect(await review(cycleId)).toEqual(current);
      } else {
        expect(cycle!.closedAt).toBeNull();
        expect(initiative!.state).toBe("in_review");
        expect(await review(cycleId)).toMatchObject({ status: "returned", returnReason: "Clinical evidence needs revision" });
      }
    } finally {
      release.resolve();
      await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]);
    }
  });

  it("rejects an unseen revision and preserves the signed receipt through an explicit return/redraft", async () => {
    const { cycleId } = await fixture(true);
    const viewed = await review(cycleId);
    await runSingleDomainDraft(db.dbA, cycleId, domain, immediatePort("A different draft"));
    await expect(service.signReview(db.dbB, cycleId, domain, reviewer, null, {
      expectedRevision: viewed.revision, expectedEvidencePacketId: null,
    })).rejects.toThrow();
    const current = await review(cycleId);
    expect(current.status).toBe("drafted");
    await service.signReview(db.dbB, cycleId, domain, reviewer, null, {
      expectedRevision: current.revision, expectedEvidencePacketId: null,
    });
    const signed = await review(cycleId);
    const [receipt] = await db.dbB.select().from(auditEvents).where(eq(auditEvents.id, signed.signatureEventId!));
    expect(receipt!.metadata).toMatchObject({ signedMd: "A different draft", revision: signed.revision });
    await expect(service.runReviewAgent(db.dbA, cycleId, domain, reviewer, null, immediatePort("Attempt to replace signed text"))).rejects.toThrow();
    expect(await review(cycleId)).toEqual(signed);
    await service.returnReview(db.dbA, cycleId, domain, reviewer, null, "Explicit request to revise the open review", signed.revision);
    await service.runReviewAgent(db.dbA, cycleId, domain, reviewer, null, immediatePort("New draft after human return"));
    const [preserved] = await db.dbB.select().from(auditEvents).where(eq(auditEvents.id, signed.signatureEventId!));
    expect(preserved).toEqual(receipt);
    expect(await review(cycleId)).toMatchObject({ status: "drafted", draftMd: "New draft after human return" });
  });

  it("rejects signing and redrafting after the cycle closes", async () => {
    const { initiativeId, cycleId } = await fixture(true);
    const current = await review(cycleId);
    await approve(db.dbA, initiativeId);
    await expect(service.signReview(db.dbB, cycleId, domain, reviewer, null, {
      expectedRevision: current.revision, expectedEvidencePacketId: null,
    })).rejects.toThrow();
    await expect(service.runReviewAgent(db.dbB, cycleId, domain, reviewer, null, immediatePort("Late draft"))).rejects.toThrow();
    expect(await review(cycleId)).toEqual(current);
  });

  it("rolls back draft persistence if its actor-attributed audit insert fails", async () => {
    const { initiativeId, cycleId } = await fixture(true);
    const before = await review(cycleId);
    // The failure fixture is confined to this newly created database and
    // this initiative; append-only production triggers remain enabled.
    await db.control.query("create table review_test_audit_failure (initiative_id text primary key)");
    await db.control.query("insert into review_test_audit_failure values ($1)", [initiativeId]);
    await db.control.query(`
      create function review_test_reject_actor_audit() returns trigger language plpgsql as $$
      begin
        if new.action = 'review_agent_run' and exists (
          select 1 from review_test_audit_failure where initiative_id = new.initiative_id
        ) then
          raise exception 'Intentional isolated actor audit failure';
        end if;
        return new;
      end;
      $$`);
    await db.control.query(`create trigger review_test_reject_actor_audit
      before insert on audit_events for each row execute function review_test_reject_actor_audit()`);
    await expect(service.runReviewAgent(db.dbA, cycleId, domain, reviewer, null, immediatePort("Must roll back"))).rejects.toThrow();
    const after = await review(cycleId);
    expect(after).toMatchObject({
      status: before.status, draftMd: before.draftMd, citations: before.citations,
      reviewer: before.reviewer, returnReason: before.returnReason, signedAt: before.signedAt,
    });
    const actorAudits = await db.dbB.select().from(auditEvents).where(and(
      eq(auditEvents.initiativeId, initiativeId), eq(auditEvents.action, "review_agent_run"),
    ));
    expect(actorAudits).toHaveLength(0);
    // A failed audit must not have disabled the append-only safeguard.
    const existingAudit = await db.dbB.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId)).limit(1);
    await expect(db.dbB.execute(sql`update audit_events set detail = 'must not change' where id = ${existingAudit[0]!.id}`)).rejects.toThrow();
  });
});
