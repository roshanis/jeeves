import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { auditEvents, controlExceptions, effectiveControls } from "../db/schema";
import * as svc from "./exception-service";
import { IllegalTransitionError, NotFoundError, ValidationError } from "./initiative-service";

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

describe("exception-service", () => {
  it("request creates a 'requested' exception, flips the control, and audits", async () => {
    const { ecId, controlId } = await anEffectiveControl();
    const res = await svc.requestException(db, ecId, REQUESTER, "Vendor SOC2 renewal in progress.");
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
    await svc.requestException(db, ecId, REQUESTER, "first");
    await expect(svc.requestException(db, ecId, REQUESTER, "second")).rejects.toThrow(ValidationError);
  });

  it("404s a request against an unknown effective control", async () => {
    await expect(svc.requestException(db, "ec-nope", REQUESTER, "x")).rejects.toThrow(NotFoundError);
  });

  it("an approver (not the requester) can approve; expiry is set", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    const res = await svc.decideException(db, req.id, APPROVER, true, "Time-boxed while remediation lands.");
    expect(res.status).toBe("approved");
    expect(typeof res.expiresAt).toBe("number");
  });

  it("a non-decider role cannot decide (IllegalTransitionError)", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    await expect(svc.decideException(db, req.id, REQUESTER, true, "self")).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it("separation of duties: an approver cannot decide an exception they requested", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, APPROVER, "approver-requested");
    await expect(svc.decideException(db, req.id, APPROVER, true, "self-approve")).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it("rejecting returns the control to overdue", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    await svc.decideException(db, req.id, APPROVER, false, "Insufficient justification.");
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");
  });

  it("an approved exception can be revoked by an admin, returning the control to overdue", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    await svc.decideException(db, req.id, APPROVER, true, "granted");
    const rev = await svc.revokeException(db, req.id, ADMIN, "Risk posture changed.");
    expect(rev.status).toBe("revoked");
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");
  });

  it("renewing an approved exception opens a new 'requested' one that supersedes it", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    await svc.decideException(db, req.id, APPROVER, true, "granted");
    const renewal = await svc.renewException(db, req.id, REQUESTER, "Extend while audit completes.");
    expect(renewal.status).toBe("requested");

    const [row] = await db.select().from(controlExceptions).where(eq(controlExceptions.id, renewal.id));
    expect(row!.supersedesId).toBe(req.id);
  });

  it("expireDueExceptions expires an approved exception past its deadline and is idempotent", async () => {
    const { ecId } = await anEffectiveControl();
    const req = await svc.requestException(db, ecId, REQUESTER, "reason");
    const pastExpiry = Date.now() - 1000;
    await svc.decideException(db, req.id, APPROVER, true, "granted", pastExpiry);

    const expired = await svc.expireDueExceptions(db, Date.now());
    expect(expired).toContain(req.id);
    const [ec] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, ecId));
    expect(ec!.status).toBe("overdue");

    // Idempotent: a second sweep finds nothing.
    const again = await svc.expireDueExceptions(db, Date.now());
    expect(again).toHaveLength(0);
  });
});
