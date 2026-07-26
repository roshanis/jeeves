import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { auditEvents, controlDefinitions, controlExceptions, deploymentVersions, effectiveControls } from "../db/schema";
import * as svc from "./exception-service";
import { ConflictError, IllegalTransitionError, NotFoundError, ValidationError, createDraft } from "./initiative-service";
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

async function anEffectiveControl(): Promise<{ ecId: string; controlId: string }> {
  const rows = await db.select().from(effectiveControls);
  expect(rows.length).toBeGreaterThan(0);
  return { ecId: rows[0]!.id, controlId: rows[0]!.controlId };
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

  it("an approved exception can be revoked by an admin, returning the control to overdue", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, null, "reason");
    await svc.decideException(db, req.id, APPROVER, null, true, "granted");
    const rev = await svc.revokeException(db, req.id, ADMIN, null, "Risk posture changed.");
    expect(rev.status).toBe("revoked");
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");
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
    await svc.decideException(db, req.id, APPROVER, null, true, "granted", pastExpiry);

    const expired = await svc.expireDueExceptions(db, Date.now());
    expect(expired).toContain(req.id);
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");

    // Idempotent: a second sweep finds nothing.
    const again = await svc.expireDueExceptions(db, Date.now());
    expect(again).toHaveLength(0);
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

    it("requestException: the owning workspace session succeeds", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      const res = await svc.requestException(db, ecId, REQUESTER, "ws-A", "reason");
      expect(res.status).toBe("requested");
    });

    it("requestException: a null-workspace session cannot request against a workspace-tagged control", async () => {
      const { ecId } = await anEffectiveControlInWorkspace("ws-A");
      await expect(svc.requestException(db, ecId, REQUESTER, null, "reason")).rejects.toThrow(NotFoundError);
    });

    it("requestException: a seeded (null-workspace) effective control is requestable from ANY session workspace", async () => {
      const { ecId } = await anEffectiveControlInWorkspace(null);
      const res = await svc.requestException(db, ecId, REQUESTER, "ws-anything", "reason");
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
      const pastExpiry = Date.now() - 1000;
      await svc.decideException(db, original.id, APPROVER, null, true, "granted", pastExpiry);

      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew while audit completes");
      expect(renewal.status).toBe("requested");

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
      await svc.decideException(db, original.id, APPROVER, null, true, "granted", pastExpiry);

      await svc.expireDueExceptions(db, Date.now());
      const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
      expect(ec!.status).toBe("overdue");
    });

    it("supersession is best-effort: approving a renewal whose original already expired does not fail, and writes no supersede audit", async () => {
      const { ecId } = await anEffectiveControl();
      const original = await svc.requestException(db, ecId, REQUESTER, null, "reason");
      const pastExpiry = Date.now() - 1000;
      await svc.decideException(db, original.id, APPROVER, null, true, "granted", pastExpiry);

      const renewal = await svc.renewException(db, original.id, REQUESTER, null, "renew");
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
      await svc.decideException(db, req.id, APPROVER, null, true, "granted", pastExpiry);

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
  });
});
