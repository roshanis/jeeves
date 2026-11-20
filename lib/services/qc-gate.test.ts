import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import {
  auditEvents,
  initiatives,
  intakeVersions,
  reviewCycles,
  reviewDecisions,
  reviewNotifications,
  riskAssessments,
} from "@/lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { IntakePayload } from "@/lib/intake/types";
import { TRIAGE_READY_CHAMPION_PAYLOAD } from "../../tests/fixtures/triage-ready-intake";
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

  async function submitted(payload: IntakePayload = TRIAGE_READY_CHAMPION_PAYLOAD): Promise<string> {
    const draft = await svc.createDraft(testDb, {
      payload,
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

  describe("REQUIRED_FOR_TIER gaps block passing QC (d01)", () => {
    async function counts(id: string) {
      return {
        ra: (await testDb.select().from(riskAssessments)).length,
        cycles: (await testDb.select().from(reviewCycles)).length,
        decisions: (await testDb.select().from(reviewDecisions)).length,
        notifications: (await testDb.select().from(reviewNotifications)).length,
        audit: (await testDb.select().from(auditEvents).where(eq(auditEvents.initiativeId, id))).length,
      };
    }

    it("refuses the pass with a typed error listing the open gap and writes nothing", async () => {
      const id = await submitted(CHAMPION_PREFILL_PAYLOAD);
      await svc.startQc(testDb, id, PROGRAM, null);
      const before = await counts(id);

      const err = await svc.triage(testDb, id, SYSTEM, null, PROGRAM).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(svc.IntakeTierGapsError);
      expect(err).toBeInstanceOf(svc.ValidationError);
      const gapErr = err as InstanceType<typeof svc.IntakeTierGapsError>;
      expect(gapErr.code).toBe("INTAKE_TIER_GAPS");
      expect(gapErr.gaps).toEqual([
        {
          ruleId: "RFT-02",
          level: "REQUIRED_FOR_TIER",
          field: "data.retentionIntent",
          message: expect.stringContaining("retention intent is required"),
        },
      ]);

      const [row] = await testDb.select().from(initiatives).where(eq(initiatives.id, id));
      expect(row!.state).toBe("in_qc");
      expect(row!.tier).toBeNull();
      expect(await counts(id)).toEqual(before);
    });

    it("lists every open gap in rule order, including the tier-derived RFT-07", async () => {
      const id = await submitted({
        ...TRIAGE_READY_CHAMPION_PAYLOAD,
        data: { ...TRIAGE_READY_CHAMPION_PAYLOAD.data, phiCategories: [], retentionIntent: null },
        populationImpact: {
          ...TRIAGE_READY_CHAMPION_PAYLOAD.populationImpact,
          expectedHarms: TRIAGE_READY_CHAMPION_PAYLOAD.populationImpact.expectedBenefits,
        },
      });
      await svc.startQc(testDb, id, PROGRAM, null);

      const err = (await svc.triage(testDb, id, SYSTEM, null).catch((e: unknown) => e)) as InstanceType<
        typeof svc.IntakeTierGapsError
      >;
      expect(err).toBeInstanceOf(svc.IntakeTierGapsError);
      expect(err.gaps.map((g) => g.ruleId)).toEqual(["RFT-01", "RFT-02", "RFT-07"]);
      expect(err.gaps.every((g) => g.level === "REQUIRED_FOR_TIER")).toBe(true);
    });

    it("a refused intake can be returned, fixed, resubmitted and then passes QC once", async () => {
      const id = await submitted(CHAMPION_PREFILL_PAYLOAD);
      await svc.startQc(testDb, id, PROGRAM, null);
      await expect(svc.triage(testDb, id, SYSTEM, null, PROGRAM)).rejects.toBeInstanceOf(
        svc.IntakeTierGapsError,
      );

      await svc.returnFromQc(testDb, id, PROGRAM, "Answer the data-retention question.", null);
      await svc.updateIntakeDraft(testDb, {
        initiativeId: id,
        payload: TRIAGE_READY_CHAMPION_PAYLOAD,
        expectedVersion: 1,
        actor: REQUESTER,
        workspaceId: null,
      });
      await svc.submitIntake(testDb, id, REQUESTER, null);
      await svc.startQc(testDb, id, PROGRAM, null);

      const res = await svc.triage(testDb, id, SYSTEM, null, PROGRAM);
      expect(res.branch).toBe("review");
      expect(res).toMatchObject({ tier: "critical" });
      expect(res.requiredDomains).toHaveLength(8);
      const events = await testDb.select().from(auditEvents).where(eq(auditEvents.initiativeId, id));
      expect(events.filter((e) => e.action === "qc_passed")).toHaveLength(1);
    });

    it("a submitted intake that is not in QC is still an illegal transition, not a gap refusal", async () => {
      const id = await submitted(CHAMPION_PREFILL_PAYLOAD);
      const err = await svc.triage(testDb, id, SYSTEM, null).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(svc.IllegalTransitionError);
      expect(err).not.toBeInstanceOf(svc.IntakeTierGapsError);
      expect(await stateOf(id)).toBe("submitted");
    });

    it("a foreign workspace gets NotFoundError, not the gap list, for an intake in QC with an open gap", async () => {
      const draft = await svc.createDraft(testDb, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
        workspaceId: "ws-A",
      });
      await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, "ws-A");
      await svc.startQc(testDb, draft.initiativeId, PROGRAM, "ws-A");

      const err = await svc.triage(testDb, draft.initiativeId, SYSTEM, "ws-B", PROGRAM).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(svc.NotFoundError);
      expect(err).not.toBeInstanceOf(svc.IntakeTierGapsError);
      expect(await stateOf(draft.initiativeId)).toBe("in_qc");
    });
  });
});
