import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import {
  auditEvents,
  initiatives,
  intakeVersions,
  reviewDecisions,
  reviewNotifications,
} from "@/lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { Actor } from "@/lib/domain/types";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const svc = await import("./initiative-service");

const REQUESTER: Actor = { id: "priya-raman", role: "requester" };
const PROGRAM: Actor = { id: "nia-okafor", role: "program" };
const ADMIN: Actor = { id: "ray-chen", role: "admin" };
const SYSTEM: Actor = { id: "system", role: "system" };

/**
 * QC gate, service level.
 *
 * The property that matters: NOTHING reaches the review fan-out without
 * passing through QC. triage() asks every required domain at once, so a
 * half-complete intake could otherwise spend eight reviewers' time before
 * anyone read it.
 */
describe("QC gate", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(testDb);
  });

  async function submitted(): Promise<string> {
    const draft = await svc.createDraft(testDb, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: REQUESTER,
      requesterName: "Priya Raman",
      workspaceId: null,
    });
    await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, null);
    return draft.initiativeId;
  }

  async function stateOf(id: string): Promise<string> {
    const [row] = await testDb.select().from(initiatives).where(eq(initiatives.id, id));
    return row!.state;
  }

  it("blocks the fan-out until QC has been entered", async () => {
    const id = await submitted();

    // The gate. Before this change, this call succeeded and opened 8 reviews.
    await expect(svc.triage(testDb, id, SYSTEM, null)).rejects.toThrow();

    expect(await stateOf(id)).toBe("submitted");
    expect(await testDb.select().from(reviewDecisions)).toHaveLength(0);
    expect(await testDb.select().from(reviewNotifications)).toHaveLength(0);
  });

  it("lets the program office open QC, then triage opens the fan-out", async () => {
    const id = await submitted();

    const qc = await svc.startQc(testDb, id, PROGRAM, null);
    expect(qc.state).toBe("in_qc");
    expect(await stateOf(id)).toBe("in_qc");
    // Still nothing asked of anyone — QC is a check, not a routing step.
    expect(await testDb.select().from(reviewDecisions)).toHaveLength(0);

    const res = await svc.triage(testDb, id, SYSTEM, null);
    expect(res.branch).toBe("review");
    expect((await testDb.select().from(reviewDecisions)).length).toBeGreaterThan(0);
  });

  it("lets an admin open QC too", async () => {
    const id = await submitted();
    await expect(svc.startQc(testDb, id, ADMIN, null)).resolves.toMatchObject({ state: "in_qc" });
  });

  it("will not let the requester open QC on their own intake", async () => {
    const id = await submitted();
    await expect(svc.startQc(testDb, id, REQUESTER, null)).rejects.toThrow();
    expect(await stateOf(id)).toBe("submitted");
  });

  it("will not let an agent open QC — a self-opening gate is not a gate", async () => {
    const id = await submitted();
    await expect(svc.startQc(testDb, id, SYSTEM, null)).rejects.toThrow();
    expect(await stateOf(id)).toBe("submitted");
  });

  it("returns a failed intake to the requester with the reason on the audit trail", async () => {
    const id = await submitted();
    await svc.startQc(testDb, id, PROGRAM, null);

    const reason = "Data sources list is empty and retention intent contradicts H-02.";
    const res = await svc.returnFromQc(testDb, id, PROGRAM, reason, null);

    expect(res.state).toBe("intake_draft");
    expect(await stateOf(id)).toBe("intake_draft");

    const events = await testDb.select().from(auditEvents).where(eq(auditEvents.initiativeId, id));
    expect(events.some((e) => e.detail.includes(reason))).toBe(true);
  });

  it("reopens the intake for editing when it is returned", async () => {
    const id = await submitted();
    await svc.startQc(testDb, id, PROGRAM, null);
    await svc.returnFromQc(testDb, id, PROGRAM, "Needs a real business problem.", null);

    const [intake] = await testDb
      .select()
      .from(intakeVersions)
      .where(eq(intakeVersions.initiativeId, id));
    // Left submitted:true, the requester's form would stay locked and the
    // completeness meter would read as finished.
    expect(intake!.submitted).toBe(false);
  });

  it("refuses a return with no reason", async () => {
    const id = await submitted();
    await svc.startQc(testDb, id, PROGRAM, null);

    await expect(svc.returnFromQc(testDb, id, PROGRAM, "   ", null)).rejects.toThrow(
      /requires a reason/i,
    );
    expect(await stateOf(id)).toBe("in_qc");
  });

  it("a returned intake can be resubmitted and pass QC the second time", async () => {
    const id = await submitted();
    await svc.startQc(testDb, id, PROGRAM, null);
    await svc.returnFromQc(testDb, id, PROGRAM, "Fix the data sources.", null);

    // The requester resubmits; the loop is not a dead end.
    await svc.submitIntake(testDb, id, REQUESTER, null);
    expect(await stateOf(id)).toBe("submitted");

    await svc.startQc(testDb, id, PROGRAM, null);
    const res = await svc.triage(testDb, id, SYSTEM, null);
    expect(res.branch).toBe("review");
  });

  it("records QC entry on the audit trail", async () => {
    const id = await submitted();
    await svc.startQc(testDb, id, PROGRAM, null);

    const events = await testDb.select().from(auditEvents).where(eq(auditEvents.initiativeId, id));
    expect(events.some((e) => /QC/i.test(e.detail))).toBe(true);
  });
});
