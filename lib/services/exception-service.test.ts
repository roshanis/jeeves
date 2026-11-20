import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PgSelectBase } from "drizzle-orm/pg-core";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { recordLocks } from "../db/test-lock-recorder";
import { seedDatabase } from "../../scripts/seed";
import { auditEvents, controlDefinitions, controlExceptions, deploymentVersions, effectiveControls } from "../db/schema";
import * as svc from "./exception-service";
import { selectEffectiveControlsWithLapsedResolved } from "./exception-expiry";
import { ConflictError, IllegalTransitionError, NotFoundError, ValidationError, createDraft, generateEffectiveControls } from "./initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";

const REQUESTER = { id: "marcus-webb", role: "reviewer" as const }; // a stakeholder
const APPROVER = { id: "angela-torres", role: "approver" as const };
const ADMIN = { id: "ray-chen", role: "admin" as const };

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await seedDatabase(db);
});

afterEach(async () => {
  await closeTestDb(db);
});

/**
 * Approval refuses an expiry that is not in the future (L1), so tests that
 * need an approved-but-lapsed row approve normally and back-date the row.
 */
async function approveAlreadyExpired(exceptionId: string, expiresAt: number): Promise<void> {
  await svc.decideException(db, exceptionId, APPROVER, null, true, "granted");
  await db.update(controlExceptions).set({ expiresAt }).where(eq(controlExceptions.id, exceptionId));
}

// Filtered to a genuinely 'overdue' seeded control (fwa-anomaly-detector's
// D-02) rather than just `rows[0]` — P2-8's status gate on `requestException`
// means an arbitrary first row (many of which are seeded 'met') is no longer
// a valid target for these tests.
async function anEffectiveControl(): Promise<{ ecId: string; controlId: string }> {
  const rows = await db.select().from(effectiveControls).where(eq(effectiveControls.status, "overdue"));
  expect(rows.length).toBeGreaterThan(0);
  return { ecId: rows[0]!.id, controlId: rows[0]!.controlId };
}

/** A fresh effective control seeded directly at the given status, for P2-8 gate/restore tests. */
async function anEffectiveControlWithStatus(status: string): Promise<{ ecId: string; controlId: string }> {
  const draft = await createDraft(db, {
    payload: CHAMPION_PREFILL_PAYLOAD,
    requesterActor: { id: "priya-raman", role: "requester" },
    requesterName: "Priya Raman",
    workspaceId: null,
  });
  const [def] = await db.select().from(controlDefinitions).limit(1);
  const deploymentId = `dep-test-${randomUUID()}`;
  await db.insert(deploymentVersions).values({
    id: deploymentId,
    initiativeId: draft.initiativeId,
    version: "v1.0",
    status: "deployed",
    modelVersion: null,
    selfHosted: false,
    feedbackProvenanceSignedOff: false,
    deployedAt: new Date(),
    pausedAt: null,
    retiredAt: null,
  });
  const ecId = `ec-test-${randomUUID()}`;
  await db.insert(effectiveControls).values({
    id: ecId,
    deploymentId,
    controlId: def!.id,
    version: 1,
    status,
    thresholdOverride: null,
    evidence: null,
    evidenceAt: null,
    dueAt: null,
    remediationOwner: null,
    createdAt: new Date(),
  });
  return { ecId, controlId: def!.id };
}

/**
 * A fresh effective control whose deployment/initiative chain is tagged with
 * `workspaceId` (or left seeded/shared when `null`) — for workspace-
 * authorization tests. Built directly (deploymentVersions/effectiveControls
 * inserted straight into the DB) rather than through the full triage ->
 * decide -> generateEffectiveControls pipeline, since only the ec ->
 * deployment -> initiative chain matters here.
 */
async function anEffectiveControlInWorkspace(
  workspaceId: string | null,
): Promise<{ ecId: string; controlId: string; initiativeId: string }> {
  const draft = await createDraft(db, {
    payload: CHAMPION_PREFILL_PAYLOAD,
    requesterActor: { id: "priya-raman", role: "requester" },
    requesterName: "Priya Raman",
    workspaceId,
  });
  const [def] = await db.select().from(controlDefinitions).limit(1);
  const deploymentId = `dep-test-${randomUUID()}`;
  await db.insert(deploymentVersions).values({
    id: deploymentId,
    initiativeId: draft.initiativeId,
    version: "v1.0",
    status: "deployed",
    modelVersion: null,
    selfHosted: false,
    feedbackProvenanceSignedOff: false,
    deployedAt: new Date(),
    pausedAt: null,
    retiredAt: null,
  });
  const ecId = `ec-test-${randomUUID()}`;
  await db.insert(effectiveControls).values({
    id: ecId,
    deploymentId,
    controlId: def!.id,
    version: 1,
    status: "overdue",
    thresholdOverride: null,
    evidence: null,
    evidenceAt: null,
    dueAt: null,
    remediationOwner: null,
    createdAt: new Date(),
  });
  return { ecId, controlId: def!.id, initiativeId: draft.initiativeId };
}

// All exceptions in these tests target seeded (null-workspace) effective
// controls/initiatives, so `null` is always the correct — and always
// authorized — sessionWorkspaceId. Cross-workspace authorization is covered
// separately below and in app/api/exceptions/__tests__/routes.test.ts.
describe("exception-service", () => {
  it("request creates a 'requested' exception, flips the control, and audits", async () => {
    const { ecId, controlId } = await anEffectiveControl();
    const res = await svc.requestException(db, ecId, REQUESTER, null, "Vendor SOC2 renewal in progress.");
    expect(res.status).toBe("requested");
    expect(res.controlId).toBe(controlId);

    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("exception_requested");

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "control_exception_requested"));
    expect(events.length).toBe(1);
  });

  it("rejects a second active request for the same control", async () => {
    const { ecId } = await anEffectiveControl();
    await svc.requestException(db, ecId, REQUESTER, null, "first");
    await expect(svc.requestException(db, ecId, REQUESTER, null, "second")).rejects.toThrow(ValidationError);
  });

  it("404s a request against an unknown effective control", async () => {
    await expect(svc.requestException(db, "ec-nope", REQUESTER, null, "x")).rejects.toThrow(NotFoundError);
  });

  it("an approver (not the requester) can approve; expiry is set", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    const res = await svc.decideException(
      db,
      req.id,
      APPROVER,
      null,
      true,
      "Time-boxed while remediation lands.",
    );
    expect(res.status).toBe("approved");
    expect(typeof res.expiresAt).toBe("number");
  });

  it("a non-decider role cannot decide (IllegalTransitionError)", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await expect(svc.decideException(db, req.id, REQUESTER, null, true, "self")).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it("separation of duties: an approver cannot decide an exception they requested", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, APPROVER, null, "approver-requested");
    await expect(svc.decideException(db, req.id, APPROVER, null, true, "self-approve")).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it("rejecting returns the control to overdue", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, false, "Insufficient justification.");
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");
  });

  it("deciding an exception that is already decided is a state conflict (409), not a validation error", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    await expect(svc.decideException(db, req.id, APPROVER, null, true, "again")).rejects.toThrow(ConflictError);
  });

  describe("approval expiry bounds (L1)", () => {
    const DAY = 24 * 60 * 60 * 1000;
    async function requested() {
      const { ecId } = await anEffectiveControl();
      return svc.requestException(db, ecId, REQUESTER, null, "reason");
    }
    async function expiryOf(id: string) {
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, id));
      return row!.expiresAt;
    }

    it("defaults to 90 days when no expiry is given", async () => {
      const req = await requested();
      const before = Date.now();
      const res = await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      expect(res.expiresAt!).toBeGreaterThanOrEqual(before + 90 * DAY);
      expect(res.expiresAt!).toBeLessThanOrEqual(Date.now() + 90 * DAY);
    });

    it("accepts an expiry up to 180 days ahead", async () => {
      const req = await requested();
      const at = Date.now() + 180 * DAY - 60_000;
      const res = await svc.decideException(db, req.id, APPROVER, null, true, "granted", at);
      expect(res.expiresAt).toBe(at);
      expect(await expiryOf(req.id)).toBe(at);
    });

    it("refuses an expiry more than 180 days ahead, naming the allowed range", async () => {
      const req = await requested();
      const err = await svc.decideException(db, req.id, APPROVER, null, true, "granted", Date.now() + 181 * DAY).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toMatch(/180 days/);
    });

    it.each([["the epoch", 1], ["the past", -60_000], ["now", 0]])("refuses an expiry in %s", async (_n, delta) => {
      const req = await requested();
      const at = delta === 1 ? 1 : Date.now() + delta;
      await expect(svc.decideException(db, req.id, APPROVER, null, true, "granted", at)).rejects.toThrow(ValidationError);
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("requested");
    });

    it("ignores the expiry bound when rejecting", async () => {
      const req = await requested();
      const res = await svc.decideException(db, req.id, APPROVER, null, false, "no", 1);
      expect(res.status).toBe("rejected");
    });
  });

  it("IllegalTransitionError from the role guards carries kind 'role'", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await expect(svc.decideException(db, req.id, ADMIN, null, true, "x")).rejects.toMatchObject({ kind: "role" });
  });

  it("an approved exception can be revoked by an admin, returning the control to overdue", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    const rev = await svc.revokeException(db, req.id, ADMIN, null, "Risk posture changed.");
    expect(rev.status).toBe("revoked");
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");
  });

  it("an admin can neither approve nor reject an exception (Admin never approves), but may file a renewal like any role", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await expect(svc.decideException(db, req.id, ADMIN, null, true, "admin approve")).rejects.toThrow(IllegalTransitionError);
    await expect(svc.decideException(db, req.id, ADMIN, null, false, "admin reject")).rejects.toThrow(IllegalTransitionError);
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    const renewal = await svc.renewException(db, req.id, ADMIN, null, "admin files a renewal request");
    expect(renewal.status).toBe("requested");
  });

  it("a requester (neither approver nor admin) can renew an approved exception", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    const renewal = await svc.renewException(db, req.id, { id: "priya-raman", role: "requester" }, null, "Requester asks to extend.");
    expect(renewal.status).toBe("requested");
  });

  it("renewing an approved exception opens a new 'requested' one that supersedes it", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    const renewal = await svc.renewException(db, req.id, REQUESTER, null, "Extend while audit completes.");
    expect(renewal.status).toBe("requested");

    const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, renewal.id));
    expect(row!.supersedesId).toBe(req.id);
  });

  it("expireDueExceptions expires an approved exception past its deadline and is idempotent", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    const pastExpiry = Date.now() - 1000;
    await approveAlreadyExpired(req.id, pastExpiry);

    const expired = await svc.expireDueExceptions(db, Date.now());
    expect(expired).toContain(req.id);
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");

    // The audit record carries the deadline that lapsed, not just the sweep time.
    const [expiredEvt] = await db.select().from(auditEvents).where(eq(auditEvents.action, "control_exception_expired"));
    expect(expiredEvt!.metadata).toMatchObject({ exceptionId: req.id, expiresAt: pastExpiry });

    // Idempotent: a second sweep finds nothing.
    const again = await svc.expireDueExceptions(db, Date.now());
    expect(again).toHaveLength(0);
  });

  describe("lazy expiry: an approved exception past its date counts as expired wherever it is read (L2)", () => {
    async function lapsedApproved() {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await approveAlreadyExpired(req.id, Date.now() - 1000);
      return { ecId, id: req.id };
    }

    it("listExceptions reports the lapsed row as expired without the cron, and does not write", async () => {
      const { id } = await lapsedApproved();
      const all = await svc.listExceptions(db);
      expect(all.find((e) => e.id === id)!.status).toBe("expired");
      expect((await svc.listExceptions(db, "expired")).map((e) => e.id)).toContain(id);
      expect((await svc.listExceptions(db, "approved")).map((e) => e.id)).not.toContain(id);
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, id));
      expect(row!.status).toBe("approved");
    });

    it("the control read model no longer shows the control as excepted", async () => {
      const { ecId } = await lapsedApproved();
      const [stored] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(stored!.status).toBe("exception_requested");
      const shown = (await selectEffectiveControlsWithLapsedResolved(db, Date.now())).find((r) => r.id === ecId);
      expect(shown!.status).toBe("overdue");
    });

    it("a still-valid approved exception keeps the control excepted", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      const shown = (await selectEffectiveControlsWithLapsedResolved(db, Date.now())).find((r) => r.id === ecId);
      expect(shown!.status).toBe("exception_requested");
    });

    it("a new request on a control whose waiver lapsed is accepted, and settles the lapsed row with an audit event", async () => {
      const { ecId, id } = await lapsedApproved();
      const next = await svc.requestException(db, ecId, REQUESTER, null, "waiver ran out, asking again");
      expect(next.status).toBe("requested");
      const [old] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, id));
      expect(old!.status).toBe("expired");
      const evts = await db.select().from(auditEvents).where(eq(auditEvents.action, "control_exception_expired"));
      expect(evts.map((e) => (e.metadata as { exceptionId: string }).exceptionId)).toContain(id);
    });

    it("a lapsed exception cannot be renewed", async () => {
      const { id } = await lapsedApproved();
      await expect(svc.renewException(db, id, REQUESTER, null, "too late")).rejects.toThrow(ValidationError);
    });

    it("recompute ignores a lapsed approved row: rejecting the only pending renewal restores the control", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, req.id, REQUESTER, null, "extend");
      await db.update(controlExceptions).set({ expiresAt: Date.now() - 1000 }).where(eq(controlExceptions.id, req.id));
      await svc.decideException(db, renewal.id, APPROVER, null, false, "no");
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("overdue");
    });
  });

  describe("controls regenerated on re-approval supersede open waivers (L3)", () => {
    async function initiativeOf(ecId: string): Promise<string> {
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, ec!.deploymentId));
      return dep!.initiativeId;
    }

    it.each([["approved"], ["requested"]])("supersedes a %s waiver, audits it, and gives the new revision no exception", async (state) => {
      const { ecId, controlId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      if (state === "approved") await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      const initiativeId = await initiativeOf(ecId);

      await generateEffectiveControls(db, initiativeId);

      const [old] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(old!.status).toBe("superseded");
      const [evt] = await db.select().from(auditEvents).where(eq(auditEvents.action, "control_exception_superseded"));
      expect(evt).toMatchObject({ initiativeId, before: state, after: "superseded" });
      expect(evt!.detail).toMatch(/controls regenerated on re-approval/);
      expect(evt!.metadata).toMatchObject({ exceptionId: req.id, controlId });

      const [oldEc] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      const revisions = await db.select().from(effectiveControls).where(eq(effectiveControls.deploymentId, oldEc!.deploymentId));
      const newest = revisions.filter((r) => r.controlId === controlId).sort((a, b) => b.version - a.version)[0]!;
      expect(newest.id).not.toBe(ecId);
      expect(newest.status).toBe("pending");
      const onNew = await db.select().from(controlExceptions).where(eq(controlExceptions.effectiveControlId, newest.id));
      expect(onNew).toHaveLength(0);
      // The stale revision row is not written to.
      expect(oldEc!.status).toBe("exception_requested");
    });

    it("leaves waivers on other deployments' controls and already-terminal rows alone", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, req.id, APPROVER, null, false, "no");
      await generateEffectiveControls(db, await initiativeOf(ecId));
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("rejected");
      expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "control_exception_superseded"))).toHaveLength(0);
    });
  });

  describe("expiry sweep (L2 / domain-F11)", () => {
    it("continues past a row that fails and expires the rest", async () => {
      const first = await anEffectiveControl();
      const second = await anEffectiveControlWithStatus("overdue");
      const ids: string[] = [];
      for (const ec of [{ id: first.ecId }, { id: second.ecId }]) {
        const req = await svc.requestException(db, ec.id, REQUESTER, null, "reason");
        await approveAlreadyExpired(req.id, Date.now() - 1000);
        ids.push(req.id);
      }
      const realTransaction = db.transaction.bind(db);
      let calls = 0;
      const spy = vi.spyOn(db, "transaction").mockImplementation(((fn: never, cfg: never) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("boom on first row"));
        return realTransaction(fn, cfg);
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const expired = await svc.expireDueExceptions(db, Date.now());
      spy.mockRestore();
      errSpy.mockRestore();
      expect(expired).toHaveLength(1);
      const after = await db.select().from(controlExceptions);
      const statuses = ids.map((i) => after.find((r) => r.id === i)!.status).sort();
      expect(statuses).toEqual(["approved", "expired"]);
    });

    it("records the row's own expiry date in the audit detail, not the sweep time", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      const lapsedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
      await approveAlreadyExpired(req.id, lapsedAt);
      await svc.expireDueExceptions(db, Date.now());
      const [evt] = await db.select().from(auditEvents).where(eq(auditEvents.action, "control_exception_expired"));
      expect(evt!.detail).toContain(new Date(lapsedAt).toISOString());
      expect(evt!.metadata).toMatchObject({ expiresAt: lapsedAt });
    });
  });

  /* -----------------------------------------------------------------------
   * Review finding P2-8 (status-integrity bug): `requestException` had no
   * precondition on the target control's status, and `recomputeControlStatus`
   * unconditionally forced 'overdue' once no active exceptions remained.
   * request-then-reject (or revoke/expire of the last active exception)
   * against a control that wasn't 'overdue' when the exception was requested
   * silently corrupted its status. Fixed by (a) gating `requestException` to
   * controls whose status is 'overdue' or 'breached', and (b) recording
   * `statusAtRequest` on the exception row and restoring it — instead of a
   * hardcoded 'overdue' — on a terminal transition that leaves no other
   * active exception.
   * -------------------------------------------------------------------- */
  describe("status-integrity gate and restore (review P2-8)", () => {
    it("rejects a request against a 'met' control with ValidationError", async () => {
      const { ecId } = await anEffectiveControlWithStatus("met");
      await expect(svc.requestException(db, ecId, REQUESTER, null, "reason")).rejects.toThrow(ValidationError);
    });

    it("rejects a request against a 'pending' control with ValidationError", async () => {
      const { ecId } = await anEffectiveControlWithStatus("pending");
      await expect(svc.requestException(db, ecId, REQUESTER, null, "reason")).rejects.toThrow(ValidationError);
    });

    it("allows a request against a 'breached' control", async () => {
      const { ecId } = await anEffectiveControlWithStatus("breached");
      const res = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      expect(res.status).toBe("requested");
    });

    it("request-then-reject against an 'overdue' control leaves it 'overdue' (unchanged, still correct)", async () => {
      const { ecId } = await anEffectiveControlWithStatus("overdue");
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, req.id, APPROVER, null, false, "insufficient justification");
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("overdue");
    });

    it("full round-trip: request -> approve -> revoke restores the control to its statusAtRequest ('breached'), NOT unconditionally 'overdue'", async () => {
      const { ecId } = await anEffectiveControlWithStatus("breached");
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");

      const [reqRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(reqRow!.statusAtRequest).toBe("breached");

      await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      await svc.revokeException(db, req.id, ADMIN, null, "risk posture changed");

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("breached");
    });

    it("full round-trip via expiry: request -> approve -> expire restores the control to its statusAtRequest ('breached')", async () => {
      const { ecId } = await anEffectiveControlWithStatus("breached");
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      const pastExpiry = Date.now() - 1000;
      await approveAlreadyExpired(req.id, pastExpiry);

      await svc.expireDueExceptions(db, Date.now());
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("breached");
    });

    it("a renewal's statusAtRequest propagates from the original it renews, so restoring after the renewal is revoked still yields the true origin status", async () => {
      const { ecId } = await anEffectiveControlWithStatus("breached");
      const original = await svc.requestException(db, ecId, REQUESTER, null, "original reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew");

      const [renewalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, renewal.id));
      expect(renewalRow!.statusAtRequest).toBe("breached");

      await svc.decideException(db, renewal.id, APPROVER, null, true, "granted renewal"); // supersedes original
      await svc.revokeException(db, renewal.id, ADMIN, null, "risk posture changed");

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("breached");
    });
  });

  /* -----------------------------------------------------------------------
   * Security-hardening pass — external-review finding #1: workspace
   * isolation is not an authorization boundary on mutations. Exception
   * mutations resolve the owning initiative via effectiveControl ->
   * deployment -> initiative (requestException) or directly from the
   * control_exceptions row's own `initiativeId` (decideException/
   * revokeException/renewException) and enforce it.
   * -------------------------------------------------------------------- */
  describe("workspace authorization on exception mutations (external-review finding #1)", () => {
    it("requestException: a mismatched workspace session gets NotFoundError (same shape as unknown id)", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      await expect(svc.requestException(db, ecId, REQUESTER, "ws-B", "reason")).rejects.toThrow(
        NotFoundError,
      );
      await expect(svc.requestException(db, ecId, REQUESTER, "ws-B", "reason")).rejects.toThrow(
        `effectiveControl not found: ${ecId}`,
      );
    });

    it("requestException: a foreign workspace is refused without FOR UPDATE on the control; the owner still locks it", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const foreign = recordLocks(db);
      try {
        await expect(svc.requestException(db, ecId, REQUESTER, "ws-B", "reason")).rejects.toThrow(NotFoundError);
      } finally {
        foreign.spy.mockRestore();
      }
      expect(foreign.events).toContain("from:effective_controls");
      expect(foreign.events).not.toContain("lock:effective_controls");

      const owner = recordLocks(db);
      try {
        await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      } finally {
        owner.spy.mockRestore();
      }
      expect(owner.events).toContain("lock:effective_controls");
    });

    it("requestException: the owning workspace session succeeds", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const res = await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      expect(res.status).toBe("requested");
    });

    it("requestException: a null-workspace session cannot request against a workspace-tagged control", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      await expect(svc.requestException(db, ecId, REQUESTER, null, "reason")).rejects.toThrow(NotFoundError);
    });

    it("requestException: a non-null session cannot mutate a null-workspace control, with no partial write", async () => {
      const { ecId } = await anEffectiveControlInWorkspace(null);
      await expect(svc.requestException(db, ecId, REQUESTER, "ws-anything", "reason")).rejects.toThrow(NotFoundError);
      const [before] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(before!.status).toBe("overdue");
      expect(await db.select().from(controlExceptions).where(eq(controlExceptions.effectiveControlId, ecId))).toHaveLength(0);
      const res = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      expect(res.status).toBe("requested");
    });

    it("decideException: a mismatched workspace session gets NotFoundError", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const req = await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      await expect(svc.decideException(db, req.id, APPROVER, "ws-B", true, "granted")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("decideException: the owning workspace session succeeds", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const req = await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      const res = await svc.decideException(db, req.id, APPROVER, "ws-A", true, "granted");
      expect(res.status).toBe("approved");
    });

    it("no partial write happens on a workspace-mismatch rejection", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const req = await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      await expect(svc.decideException(db, req.id, APPROVER, "ws-B", true, "granted")).rejects.toThrow(
        NotFoundError,
      );
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("requested"); // unchanged
    });
  });

  /* -----------------------------------------------------------------------
   * External-review finding #5 (P1): "Exception renewals can corrupt control
   * status. Renewal leaves the original exception approved while opening a
   * second requested exception. Rejecting the renewal or later expiring the
   * old exception unconditionally marks the control overdue, even if
   * another approved exception exists." Fixed by (a) atomic supersession on
   * renewal approval and (b) deriving effective_controls.status from ALL of
   * a control's active (requested/approved) exceptions instead of writing a
   * hardcoded status on every transition.
   * -------------------------------------------------------------------- */
  describe("renewal supersession and derived control status (external-review finding #5)", () => {
    it("a second renewal while one is pending is a ValidationError, not a unique-index violation", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "original reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      await svc.renewException(db, original.id, REQUESTER, null, "first renewal");
      await expect(svc.renewException(db, original.id, REQUESTER, null, "second renewal")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejecting a renewal leaves the control 'exception_requested' — the original approved exception is still active, NOT 'overdue'", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "original reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");

      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew while audit completes");
      await svc.decideException(db, renewal.id, APPROVER, null, false, "not yet — insufficient justification");

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("exception_requested");

      const [originalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, original.id));
      expect(originalRow!.status).toBe("approved"); // untouched by the renewal's rejection

      const [renewalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, renewal.id));
      expect(renewalRow!.status).toBe("rejected");
    });

    it("approving a renewal atomically supersedes the original (approved -> superseded) and audits the supersession", async () => {
      const { ecId, controlId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "original reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");

      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew while audit completes");
      const decided = await svc.decideException(db, renewal.id, APPROVER, null, true, "granted renewal");
      expect(decided.status).toBe("approved");

      const [originalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, original.id));
      expect(originalRow!.status).toBe("superseded");

      const [renewalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, renewal.id));
      expect(renewalRow!.status).toBe("approved");

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("exception_requested"); // still active via the renewal

      const supersedeEvents = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "control_exception_superseded"));
      expect(supersedeEvents.length).toBe(1);
      expect(supersedeEvents[0]!.metadata).toMatchObject({
        exceptionId: original.id,
        supersededBy: renewal.id,
        controlId,
      });
    });

    it("the original expiring while a renewal is still requested leaves the control 'exception_requested', NOT 'overdue'", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "original reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew while audit completes");
      expect(renewal.status).toBe("requested");
      await db.update(controlExceptions).set({ expiresAt: Date.now() - 1000 }).where(eq(controlExceptions.id, original.id));

      const expired = await svc.expireDueExceptions(db, Date.now());
      expect(expired).toContain(original.id);

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("exception_requested"); // renewal is still requested

      const [originalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, original.id));
      expect(originalRow!.status).toBe("expired");
    });

    it("when no other active exception exists, expiring the sole approved exception still marks the control 'overdue'", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      const pastExpiry = Date.now() - 1000;
      await approveAlreadyExpired(original.id, pastExpiry);

      await svc.expireDueExceptions(db, Date.now());
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("overdue");
    });

    it("supersession is best-effort: approving a renewal whose original already expired does not fail, and writes no supersede audit", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew");
      await db.update(controlExceptions).set({ expiresAt: Date.now() - 1000 }).where(eq(controlExceptions.id, original.id));
      await svc.expireDueExceptions(db, Date.now()); // original: approved -> expired, out from under the renewal

      const decided = await svc.decideException(db, renewal.id, APPROVER, null, true, "granted renewal");
      expect(decided.status).toBe("approved");

      const [originalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, original.id));
      expect(originalRow!.status).toBe("expired"); // NOT overwritten to 'superseded'

      const supersedeEvents = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "control_exception_superseded"));
      expect(supersedeEvents.length).toBe(0);

      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("exception_requested");
    });

    it("supersession is best-effort: approving a renewal whose original was already revoked does not fail", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew");
      await svc.revokeException(db, original.id, ADMIN, null, "risk posture changed");

      const decided = await svc.decideException(db, renewal.id, APPROVER, null, true, "granted renewal");
      expect(decided.status).toBe("approved");

      const [originalRow] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, original.id));
      expect(originalRow!.status).toBe("revoked"); // NOT overwritten to 'superseded'
    });
  });

  /* -----------------------------------------------------------------------
   * Compare-and-set on exception state transitions (finding #5 continuation
   * — mirrors the ConflictError pattern already proven out in
   * initiative-service.test.ts's decide()/signReview() race tests): a write
   * landing between this transaction's own read and its CAS update must
   * throw ConflictError and roll back the whole transaction, never silently
   * clobber the concurrent writer's result.
   * -------------------------------------------------------------------- */
  describe("compare-and-set on exception transitions", () => {
    it("decideException: a write that lands between this transaction's read and its CAS update throws ConflictError, and the whole transaction rolls back", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === controlExceptions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent writer: revokes the exception
                    // directly, inside the SAME transaction, between
                    // decideException()'s own read and its CAS update below.
                    await realUpdate(controlExceptions)
                      .set({ status: "revoked" })
                      .where(eq(controlExceptions.id, req.id));
                    return realReturning(...args);
                  };
                  return afterWhere;
                };
                return base;
              };
            }
            return builder;
          });
          return cb(tx);
        }),
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      let caught: unknown;
      try {
        await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // The whole transaction — the injected write AND decide's own update —
      // rolled back, so the row is exactly as it was before this call.
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("requested");
    });

    it("revokeException: a write that lands between this transaction's read and its CAS update throws ConflictError, and the whole transaction rolls back", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, req.id, APPROVER, null, true, "granted");

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === controlExceptions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    await realUpdate(controlExceptions)
                      .set({ status: "expired" })
                      .where(eq(controlExceptions.id, req.id));
                    return realReturning(...args);
                  };
                  return afterWhere;
                };
                return base;
              };
            }
            return builder;
          });
          return cb(tx);
        }),
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      let caught: unknown;
      try {
        await svc.revokeException(db, req.id, ADMIN, null, "risk posture changed");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // The whole transaction — the injected write AND revoke's own update —
      // rolled back, so the row is exactly as it was before this call.
      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("approved");
    });

    it("expireDueExceptions: a row raced away from 'approved' since the sweep's SELECT is skipped silently — no throw, not counted as expired", async () => {
      const { ecId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      const pastExpiry = Date.now() - 1000;
      await approveAlreadyExpired(req.id, pastExpiry);

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === controlExceptions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent revoke landing between the sweep's
                    // outer SELECT and this row's own expire transaction.
                    await realUpdate(controlExceptions)
                      .set({ status: "revoked" })
                      .where(eq(controlExceptions.id, req.id));
                    return realReturning(...args);
                  };
                  return afterWhere;
                };
                return base;
              };
            }
            return builder;
          });
          return cb(tx);
        }),
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const expired = await svc.expireDueExceptions(db, Date.now());
      expect(expired).not.toContain(req.id); // skipped, not thrown

      spy.mockRestore();

      const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, req.id));
      expect(row!.status).toBe("revoked"); // the injected write survived; expire's CAS update did not land

      const expireEvents = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "control_exception_expired"));
      expect(expireEvents.length).toBe(0);
    });
  });

  /* -----------------------------------------------------------------------
   * Migration 0007 partial unique indexes — DB-level backstop for the
   * app-layer active-exception invariant (external-review finding #5).
   * -------------------------------------------------------------------- */
  describe("DB-level active-exception uniqueness (migration 0007)", () => {
    it("rejects a second 'requested' row for the same effective control, inserted directly", async () => {
      const { ecId, controlId } = await anEffectiveControl();
      await svc.requestException(db, ecId, REQUESTER, null, "first");
      await expect(
        db.insert(controlExceptions).values({
          id: `exc-${randomUUID()}`,
          effectiveControlId: ecId,
          controlId,
          initiativeId: null,
          status: "requested",
          reason: "direct-insert bypass",
          requestedBy: REQUESTER.id,
          requestedAt: new Date(),
          decidedBy: null,
          decidedAt: null,
          decisionReason: null,
          expiresAt: null,
          supersedesId: null,
          createdAt: new Date(),
        }),
      ).rejects.toThrow();
    });

    it("rejects a second 'approved' row for the same effective control, inserted directly", async () => {
      const { ecId, controlId } = await anEffectiveControl();
      const req = await svc.requestException(db, ecId, REQUESTER, null, "first");
      await svc.decideException(db, req.id, APPROVER, null, true, "granted");
      await expect(
        db.insert(controlExceptions).values({
          id: `exc-${randomUUID()}`,
          effectiveControlId: ecId,
          controlId,
          initiativeId: null,
          status: "approved",
          reason: "direct-insert bypass",
          requestedBy: REQUESTER.id,
          requestedAt: new Date(),
          decidedBy: APPROVER.id,
          decidedAt: new Date(),
          decisionReason: "direct-insert bypass",
          expiresAt: null,
          supersedesId: null,
          createdAt: new Date(),
        }),
      ).rejects.toThrow();
    });

    it("allows one 'requested' AND one 'approved' row simultaneously (the renewal-in-flight shape)", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      await svc.decideException(db, original.id, APPROVER, null, true, "granted");
      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew");
      expect(renewal.status).toBe("requested");

      const rows = await db.select().from(controlExceptions).where(eq(controlExceptions.effectiveControlId, ecId));
      expect(rows.map((r) => r.status).sort()).toEqual(["approved", "requested"]);
    });
  });

  /* -----------------------------------------------------------------------
   * listExceptions viewer scoping (external-review finding #2 spillover,
   * assigned to this task via GET /api/exceptions). `opts` omitted (not just
   * `{ viewerWorkspaceId: null }`) means unfiltered — for internal callers
   * like app/controls/page.tsx. The route itself always resolves and passes
   * a viewer; see app/api/exceptions/__tests__/routes.test.ts for the
   * HTTP-layer coverage of that resolution.
   * -------------------------------------------------------------------- */
  describe("listExceptions viewer scoping", () => {
    it("omitted opts returns every exception, unfiltered", async () => {
      const { ecId: ecA } = await anEffectiveControlInWorkspace("ws-A");
      const { ecId: ecB } = await anEffectiveControlInWorkspace("ws-B");
      await svc.requestException(db, ecA, REQUESTER, "ws-A", "ws-A reason");
      await svc.requestException(db, ecB, REQUESTER, "ws-B", "ws-B reason");

      const all = await svc.listExceptions(db);
      const reasons = all.map((r) => r.reason);
      expect(reasons).toContain("ws-A reason");
      expect(reasons).toContain("ws-B reason");
    });

    it("a viewer only sees null-initiative exceptions plus their own workspace's — not another workspace's", async () => {
      const { ecId: ecA } = await anEffectiveControlInWorkspace("ws-A");
      const { ecId: ecB } = await anEffectiveControlInWorkspace("ws-B");
      await svc.requestException(db, ecA, REQUESTER, "ws-A", "ws-A reason");
      await svc.requestException(db, ecB, REQUESTER, "ws-B", "ws-B reason");

      const asWsA = await svc.listExceptions(db, undefined, { viewerWorkspaceId: "ws-A" });
      const reasonsA = asWsA.map((r) => r.reason);
      expect(reasonsA).toContain("ws-A reason");
      expect(reasonsA).not.toContain("ws-B reason");

      const anonymous = await svc.listExceptions(db, undefined, { viewerWorkspaceId: null });
      const reasonsAnon = anonymous.map((r) => r.reason);
      expect(reasonsAnon).not.toContain("ws-A reason");
      expect(reasonsAnon).not.toContain("ws-B reason");
      // The seeded exception has a null initiativeId (or a null-workspace
      // initiative) and stays visible to every viewer, including anonymous.
      expect(anonymous.some((r) => r.id === "exc-seed-hr-r01")).toBe(true);
    });

    it("applies the workspace filter in the database query: other workspaces' rows are never read", async () => {
      const { ecId: ecA } = await anEffectiveControlInWorkspace("ws-A");
      const { ecId: ecB } = await anEffectiveControlInWorkspace("ws-B");
      await svc.requestException(db, ecA, REQUESTER, "ws-A", "ws-A reason");
      await svc.requestException(db, ecB, REQUESTER, "ws-B", "ws-B reason");

      const read: unknown[] = [];
      const original = PgSelectBase.prototype.then;
      const spy = vi.spyOn(PgSelectBase.prototype, "then").mockImplementation(function (this: never, res: never, rej: never) {
        return (original as (...a: unknown[]) => unknown).call(this, (rows: unknown) => { read.push(rows); return (res as (r: unknown) => unknown)?.(rows); }, rej);
      } as never);
      try {
        await svc.listExceptions(db, undefined, { viewerWorkspaceId: "ws-A" });
      } finally {
        spy.mockRestore();
      }
      expect(JSON.stringify(read)).toContain("ws-A reason");
      expect(JSON.stringify(read)).not.toContain("ws-B reason");
    });

    it("isShared means the viewer cannot act on the row (api-initiatives-F11)", async () => {
      const { ecId: ecA } = await anEffectiveControlInWorkspace("ws-A");
      await svc.requestException(db, ecA, REQUESTER, "ws-A", "ws-A reason");

      // A row without an owning workspace is shared for a viewer who has one.
      const asWsA = await svc.listExceptions(db, undefined, { viewerWorkspaceId: "ws-A" });
      expect(asWsA.find((r) => r.id === "exc-seed-hr-r01")!.isShared).toBe(true);
      // A viewer's own workspace row is theirs to act on.
      expect(asWsA.find((r) => r.reason === "ws-A reason")!.isShared).toBe(false);

      // A viewer with no workspace (a first visit, before any session) can
      // change nothing: every mutation needs a session workspace.
      const anonymous = await svc.listExceptions(db, undefined, { viewerWorkspaceId: null });
      expect(anonymous.find((r) => r.id === "exc-seed-hr-r01")!.isShared).toBe(true);

      // Unfiltered internal read: nothing is labelled shared.
      const all = await svc.listExceptions(db);
      expect(all.every((r) => r.isShared === false)).toBe(true);
    });
  });
});
