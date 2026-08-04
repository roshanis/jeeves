import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import type { IntakePayload } from "../intake/types";
import {
  auditEvents,
  controlDefinitions,
  deploymentVersions,
  effectiveControls,
  initiativeDecisions,
  initiatives,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { CONTROL_SEEDS } from "../../scripts/seed";
import { ConflictError, IllegalTransitionError, NotFoundError, ValidationError } from "./initiative-service";
import * as svc from "./initiative-service";
import { SYSTEM_ACTOR } from "./actors";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { Domain } from "../domain/types";

/** Seed just the control catalog (seed-spec §3) — not the full 12-initiative dataset,
 * which would collide with the initiatives this test suite creates directly. */
async function seedControlCatalog(db: TestDb): Promise<void> {
  for (const c of CONTROL_SEEDS) {
    await db.insert(controlDefinitions).values({
      id: c.id,
      domain: c.domain,
      name: c.name,
      applicability: c.applicability,
      policySource: c.policySource,
      owner: c.owner,
      requiredEvidence: c.requiredEvidence,
      cadence: c.cadence,
      enforcementMode: c.enforcementMode,
      exceptionProcess: c.exceptionProcess,
      remediationOwner: c.remediationOwner,
      observationKind: c.observationKind ?? null,
      tierDefaultThresholds: c.tierDefaultThresholds ?? null,
      sustainedWindow: c.sustainedWindow ?? null,
    });
  }
}

const REQUESTER = { id: "priya-raman", role: "requester" as const };
const REVIEWER = { id: "elena-vasquez", role: "reviewer" as const };
const APPROVER = { id: "angela-torres", role: "approver" as const };
const ADMIN = { id: "ray-chen", role: "admin" as const };

/** Low-tier, no-flags payload -> fast-lane eligible (mirrors seed #2 marketing-ab-tester). */
function lowTierPayload(): IntakePayload {
  return {
    ...CHAMPION_PREFILL_PAYLOAD,
    basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Marketing Copy A/B Tester" },
    overlay: {
      touchesPHI: false,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: true,
      humanInTheLoop: true,
      individualImpact: false,
    },
    data: { ...CHAMPION_PREFILL_PAYLOAD.data, phiCategories: [], retentionIntent: null },
    modelVendor: {
      buildOrBuy: "Buy (vendor)",
      vendorName: "Acme Marketing AI",
      hosting: "Vendor-hosted",
      modelType: "LLM (generative)",
    },
  };
}

describe("lib/services/initiative-service", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await seedControlCatalog(db);
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  describe("champion happy path (plan.md §2 steps 1-4)", () => {
    it("createDraft -> submit -> triage(critical, 8 domains) -> draft-run -> sign -> conditional decide -> effective controls", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      expect(draft.initiativeId).toBeTruthy();

      const initRow = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(initRow.state).toBe("intake_draft");

      // BLOCKING passes (retentionIntent gap is REQUIRED_FOR_TIER, not BLOCKING) -> submit succeeds.
      const submitResult = await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      expect(submitResult.submitted).toBe(true);

      const afterSubmit = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(afterSubmit.state).toBe("submitted");

      const triageResult = await svc.triage(db, draft.initiativeId);
      expect(triageResult.branch).toBe("review"); // critical + PHI + member-facing -> never fast-lane eligible
      expect(triageResult.tier).toBe("critical");
      expect(triageResult.requiredDomains).toHaveLength(8);
      expect(new Set(triageResult.requiredDomains).size).toBe(8);

      const afterTriage = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(afterTriage.state).toBe("in_review");

      // Move into in_review explicitly is implicit via triage->triaged; start_review not yet modeled
      // as a separate service op in this task — decide() operates once reviews are signed. Confirm
      // review_decisions rows exist, one per required domain, all pending.
      const pendingRds = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, triageResult.cycleId));
      expect(pendingRds).toHaveLength(8);
      expect(pendingRds.every((r) => r.status === "pending")).toBe(true);

      // Simulate the draft-run landing (tested separately in review-run.test.ts):
      // draft ALL required domains, since conditional approval now requires every
      // required review to be at least drafted (M2.5 completeness gate). Then sign
      // clinical-safety as its assigned reviewer.
      for (const rd of pendingRds) {
        await db
          .update(reviewDecisions)
          .set({ draftMd: `Draft ${rd.domain} assessment.`, status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
      }
      const clinicalRd = pendingRds.find((r) => r.domain === "clinical-safety")!;

      const signResult = await svc.signReview(
        db,
        triageResult.cycleId,
        "clinical-safety",
        REVIEWER,
        null,
        "Edited clinical safety assessment — reviewer approved with edits.",
      );
      expect(signResult.status).toBe("signed");

      const signedRow = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, clinicalRd.id))
      )[0]!;
      expect(signedRow.status).toBe("signed");
      expect(signedRow.reviewer).toBe(REVIEWER.id);
      expect(signedRow.draftMd).toContain("reviewer approved with edits");

      const decideResult = await svc.decide(db, draft.initiativeId, APPROVER, null, {
        decision: "conditionally_approved",
        conditions: [
          { text: "100% human review for 90 days.", controlId: "C-01" },
          { text: "Escalation protocol sign-off.", controlId: "C-02" },
        ],
      });
      expect(decideResult.type).toBe("conditionally_approved");
      expect(decideResult.after).toBe("conditionally_approved");

      const afterDecide = (
        await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId))
      )[0]!;
      expect(afterDecide.state).toBe("conditionally_approved");
      expect(afterDecide.accountableApprover).toBe(APPROVER.id);

      // External-review finding #4 ("live champion workflow stops before
      // control generation"): decide() now generates the deployment's
      // effective controls itself, in the SAME transaction as the decision
      // — no separate generateEffectiveControls() call needed on the live
      // path (the standalone export still exists as a thin wrapper, see the
      // "generateEffectiveControls" describe block below).
      expect(decideResult.controlsGenerated).toBeTruthy();
      expect(decideResult.controlsGenerated!.created).toBeGreaterThan(0);
      const deploymentId = decideResult.controlsGenerated!.deploymentId;

      const ecRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deploymentId));
      expect(ecRows).toHaveLength(decideResult.controlsGenerated!.created);
      // Critical tier + PHI + vendor + member-facing + care-coverage -> expect a broad set incl. H-01/H-02, C-01/C-02.
      const controlIds = ecRows.map((r) => r.controlId);
      expect(controlIds).toEqual(expect.arrayContaining(["H-01", "C-01", "C-02", "L-01"]));
      expect(ecRows.every((r) => r.version === 1)).toBe(true);

      const depRows = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.id, deploymentId));
      expect(depRows).toHaveLength(1);
      expect(depRows[0]!.status).toBe("awaiting_promotion_signoff");

      // Audit trail: every domain-change step wrote at least one audit event.
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.initiativeId, draft.initiativeId));
      const actions = events.map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "intake_draft_created",
          "submit",
          "triage",
          "review_signed",
          "conditionally_approve",
          "effective_controls_generated",
        ]),
      );
    });
  });

  describe("fast-lane path (seed #2-style payload)", () => {
    it("triage() branches to fast_lane_approved with policyId + named accountable approver", async () => {
      const draft = await svc.createDraft(db, {
        payload: lowTierPayload(),
        requesterActor: { id: "dan-kowalski", role: "requester" },
        requesterName: "Dan Kowalski",
      });
      const submitResult = await svc.submitIntake(db, draft.initiativeId, {
        id: "dan-kowalski",
        role: "requester",
      });
      expect(submitResult.submitted).toBe(true);

      const triageResult = await svc.triage(db, draft.initiativeId);
      expect(triageResult.branch).toBe("fast-lane");
      if (triageResult.branch !== "fast-lane") throw new Error("unreachable");
      expect(triageResult.tier).toBe("low");
      expect(triageResult.policyId).toBe("FL-2026-01");
      expect(triageResult.accountableApprover).toBe("Angela Torres");

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("fast_lane_approved");
      expect(row.accountableApprover).toBe("Angela Torres");

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.initiativeId, draft.initiativeId));
      expect(events.some((e) => e.action === "fast_lane_approve")).toBe(true);
    });

    it("fast-lane approval ALSO generates effective controls — live parity with seeded fast-lane initiatives (seed-spec #2 marketing-ab-tester carries effective_controls against a deployment row)", async () => {
      const draft = await svc.createDraft(db, {
        payload: lowTierPayload(),
        requesterActor: { id: "dan-kowalski", role: "requester" },
        requesterName: "Dan Kowalski",
      });
      await svc.submitIntake(db, draft.initiativeId, { id: "dan-kowalski", role: "requester" });
      const triageResult = await svc.triage(db, draft.initiativeId);
      expect(triageResult.branch).toBe("fast-lane");

      const deps = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, draft.initiativeId));
      expect(deps).toHaveLength(1);
      expect(deps[0]!.status).toBe("awaiting_promotion_signoff");

      const ecRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deps[0]!.id));
      expect(ecRows.length).toBeGreaterThan(0);

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.initiativeId, draft.initiativeId));
      expect(events.some((e) => e.action === "effective_controls_generated")).toBe(true);
    });
  });

  describe("separation of duties (SoD)", () => {
    async function setUpInReview() {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);
      return draft;
    }

    it("admin cannot decide() — IllegalTransitionError", async () => {
      const draft = await setUpInReview();
      await expect(
        svc.decide(db, draft.initiativeId, ADMIN, null, { decision: "approved" }),
      ).rejects.toThrow(IllegalTransitionError);

      // No partial state change: initiative stays in_review.
      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("in_review");
    });

    it("reviewer cannot decide() — IllegalTransitionError", async () => {
      const draft = await setUpInReview();
      await expect(
        svc.decide(db, draft.initiativeId, REVIEWER, null, { decision: "approved" }),
      ).rejects.toThrow(IllegalTransitionError);
    });

    it("admin cannot signReview() — IllegalTransitionError, no row change", async () => {
      await setUpInReview();
      const cycles = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.domain, "clinical-safety"));
      const rd = cycles.find((r) => r.status === "pending")!;

      await expect(svc.signReview(db, rd.cycleId, "clinical-safety", ADMIN, null)).rejects.toThrow(
        IllegalTransitionError,
      );
      const unchanged = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, rd.id))
      )[0]!;
      expect(unchanged.status).toBe("pending");
    });

    it("non-reviewer (approver) cannot signReview()", async () => {
      const draft = await setUpInReview();
      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.domain, "legal"));
      const rd = rows.find((r) => r.cycleId) ?? rows[0]!;
      void draft;
      await expect(svc.signReview(db, rd.cycleId, "legal", APPROVER, null)).rejects.toThrow(
        IllegalTransitionError,
      );
    });
  });

  describe("reviewer-domain assignment authz", () => {
    async function setUpInReview() {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);
      return draft;
    }

    it("a reviewer signing a domain they are NOT assigned to is rejected — IllegalTransitionError, no row change", async () => {
      await setUpInReview();
      // elena-vasquez (REVIEWER) is assigned clinical-safety, not privacy-hipaa.
      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.domain, "privacy-hipaa"));
      const rd = rows[0]!;

      await expect(svc.signReview(db, rd.cycleId, "privacy-hipaa", REVIEWER, null)).rejects.toThrow(
        IllegalTransitionError,
      );
      const unchanged = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, rd.id))
      )[0]!;
      expect(unchanged.status).toBe("pending");
      expect(unchanged.reviewer).toBeNull();
    });

    it("a reviewer returning a domain they are NOT assigned to is rejected — IllegalTransitionError, no row change", async () => {
      await setUpInReview();
      // marcus-webb owns privacy-hipaa, not legal.
      const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.domain, "legal"));
      const rd = rows[0]!;
      const MARCUS = { id: "marcus-webb", role: "reviewer" as const };

      await expect(
        svc.returnReview(db, rd.cycleId, "legal", MARCUS, null, "Needs more detail."),
      ).rejects.toThrow(IllegalTransitionError);
      const unchanged = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, rd.id))
      )[0]!;
      expect(unchanged.status).toBe("pending");
    });

    it("each of the 4 named reviewers CAN sign their own assigned domain (control case)", async () => {
      await setUpInReview();
      const assignments: [string, "clinical-safety" | "privacy-hipaa" | "responsible-ai" | "legal"][] = [
        ["elena-vasquez", "clinical-safety"],
        ["marcus-webb", "privacy-hipaa"],
        ["sofia-grant", "responsible-ai"],
        ["james-liu", "legal"],
      ];
      for (const [reviewerId, domain] of assignments) {
        const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.domain, domain));
        const rd = rows[0]!;
        await db
          .update(reviewDecisions)
          .set({ draftMd: `Draft for ${domain}.`, status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
        const result = await svc.signReview(
          db,
          rd.cycleId,
          domain,
          { id: reviewerId, role: "reviewer" as const },
          null,
        );
        expect(result.status).toBe("signed");
      }
    });
  });

  describe("runReviewAgent (on-demand agent run authz)", () => {
    async function setUpInReview() {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);
      return draft;
    }

    it("the assigned reviewer drafts their own domain and writes a review_agent_run audit event", async () => {
      const draft = await setUpInReview();

      const result = await svc.runReviewAgent(
        db,
        await cycleFor("clinical-safety"),
        "clinical-safety",
        REVIEWER,
        null,
        createMockAgentPort(),
      );
      expect(result.status).toBe("drafted");
      expect(result.draftMd).toBeTruthy();

      const rd = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.domain, "clinical-safety"))
      )[0]!;
      expect(rd.status).toBe("drafted");

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.initiativeId, draft.initiativeId));
      const ran = events.filter((e) => e.action === "review_agent_run");
      expect(ran).toHaveLength(1);
      expect(ran[0]!.actor).toBe("elena-vasquez");
    });

    it("a reviewer running a domain they are NOT assigned to is rejected (IllegalTransitionError)", async () => {
      await setUpInReview();
      // elena-vasquez owns clinical-safety, not privacy-hipaa.
      await expect(
        svc.runReviewAgent(
          db,
          await cycleFor("privacy-hipaa"),
          "privacy-hipaa",
          REVIEWER,
          null,
          createMockAgentPort(),
        ),
      ).rejects.toThrow(IllegalTransitionError);
    });

    it("a non-reviewer (approver) cannot run the agent (IllegalTransitionError)", async () => {
      await setUpInReview();
      await expect(
        svc.runReviewAgent(
          db,
          await cycleFor("clinical-safety"),
          "clinical-safety",
          APPROVER,
          null,
          createMockAgentPort(),
        ),
      ).rejects.toThrow(IllegalTransitionError);
    });

    it("refuses to re-draft an already-signed review (ValidationError)", async () => {
      await setUpInReview();
      const cycleId = await cycleFor("clinical-safety");
      // Draft then sign as the assigned reviewer.
      await svc.runReviewAgent(db, cycleId, "clinical-safety", REVIEWER, null, createMockAgentPort());
      await svc.signReview(db, cycleId, "clinical-safety", REVIEWER, null, "Signed clinical safety draft.");

      await expect(
        svc.runReviewAgent(db, cycleId, "clinical-safety", REVIEWER, null, createMockAgentPort()),
      ).rejects.toThrow(ValidationError);
    });

    it("404s (NotFoundError) when the (cycle, domain) review does not exist", async () => {
      await setUpInReview();
      await expect(
        svc.runReviewAgent(db, "cycle-does-not-exist", "clinical-safety", REVIEWER, null, createMockAgentPort()),
      ).rejects.toThrow(NotFoundError);
    });

    /** Resolve the cycleId that owns a given domain's pending review decision. */
    async function cycleFor(domain: string): Promise<string> {
      const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.domain, domain));
      return rows[0]!.cycleId;
    }
  });

  describe("required-review completeness gate (decide)", () => {
    const DOMAIN_REVIEWER: Record<Domain, { id: string; role: "reviewer" }> = {
      "clinical-safety": { id: "elena-vasquez", role: "reviewer" },
      "privacy-hipaa": { id: "marcus-webb", role: "reviewer" },
      "responsible-ai": { id: "sofia-grant", role: "reviewer" },
      legal: { id: "james-liu", role: "reviewer" },
      security: { id: "devon-clarke", role: "reviewer" },
      "tech-architecture": { id: "wei-zhang", role: "reviewer" },
      "data-governance": { id: "grace-kim", role: "reviewer" },
      procurement: { id: "tom-brennan", role: "reviewer" },
    };

    async function setUpInReview() {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const triageResult = await svc.triage(db, draft.initiativeId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");
      return { initiativeId: draft.initiativeId, cycleId: triageResult.cycleId };
    }

    async function draftAll(cycleId: string): Promise<Domain[]> {
      const rds = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
      for (const rd of rds) {
        await db
          .update(reviewDecisions)
          .set({ draftMd: `Draft ${rd.domain}.`, status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
      }
      return rds.map((r) => r.domain as Domain);
    }

    it("blocks `approved` until every required review is signed", async () => {
      const { initiativeId, cycleId } = await setUpInReview();
      await draftAll(cycleId); // drafted, not signed
      await expect(
        svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" }),
      ).rejects.toThrow(ValidationError);
    });

    it("blocks `conditionally_approved` while any required review is still pending", async () => {
      const { initiativeId, cycleId } = await setUpInReview();
      const rds = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
      for (const rd of rds.slice(1)) {
        await db
          .update(reviewDecisions)
          .set({ draftMd: "d", status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
      }
      await expect(
        svc.decide(db, initiativeId, APPROVER, null, {
          decision: "conditionally_approved",
          conditions: [{ text: "100% human review.", controlId: "C-01" }],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("allows `conditionally_approved` once every required review is at least drafted", async () => {
      const { initiativeId, cycleId } = await setUpInReview();
      await draftAll(cycleId);
      const res = await svc.decide(db, initiativeId, APPROVER, null, {
        decision: "conditionally_approved",
        conditions: [{ text: "100% human review.", controlId: "C-01" }],
      });
      expect(res.type).toBe("conditionally_approved");
    });

    it("allows `approved` once all 8 domain reviewers have signed (full completeness)", async () => {
      const { initiativeId, cycleId } = await setUpInReview();
      const domains = await draftAll(cycleId);
      for (const domain of domains) {
        await svc.signReview(db, cycleId, domain, DOMAIN_REVIEWER[domain], null);
      }
      const res = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(res.type).toBe("approved");
    });

    it("allows `rejected` regardless of review completeness", async () => {
      const { initiativeId } = await setUpInReview();
      const res = await svc.decide(db, initiativeId, APPROVER, null, { decision: "rejected" });
      expect(res.type).toBe("rejected");
    });
  });

  describe("requester ownership authz", () => {
    it("a non-owner requester cannot submitIntake() — IllegalTransitionError, no state change", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      // dan-kowalski is a real requester persona but does NOT own this initiative.
      const OTHER_REQUESTER = { id: "dan-kowalski", role: "requester" as const };

      await expect(svc.submitIntake(db, draft.initiativeId, OTHER_REQUESTER)).rejects.toThrow(
        IllegalTransitionError,
      );

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("intake_draft"); // unchanged
    });
  });

  describe("transactionality", () => {
    it("a forced failure mid-triage rolls back both the state change and any partial rows", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);

      // Force a failure by triaging twice concurrently isn't deterministic; instead directly
      // exercise the atomicity guarantee: corrupt the intake fields so evaluateCompleteness / JSON
      // access throws partway through triage after the transition() call already ran, and confirm
      // the initiative row was NOT advanced to 'triaged'.
      const initiativeId = draft.initiativeId;

      // Simulate a mid-transaction failure by triaging a non-existent initiative id derived from
      // a real one (loadInitiativeOrThrow throws before any write) — confirms failures before
      // writes leave no trace.
      await expect(svc.triage(db, `${initiativeId}-missing`)).rejects.toThrow();
      const rowUnchanged = (
        await db.select().from(initiatives).where(eq(initiatives.id, initiativeId))
      )[0]!;
      expect(rowUnchanged.state).toBe("submitted");

      // Now force a failure AFTER the transition()/state-update call inside the same transaction
      // by triaging twice: the second call's `transition()` from 'triaged' with action 'triage'
      // is illegal (no such rule), so it throws inside the transaction body after triage() has
      // already run once successfully. Confirm the SECOND (failed) call left no additional
      // risk_assessments/review_cycles rows and did not change state further.
      await svc.triage(db, initiativeId); // succeeds once, moves to in_review (champion is not fast-lane eligible)
      const afterFirstTriage = (
        await db.select().from(initiatives).where(eq(initiatives.id, initiativeId))
      )[0]!;
      expect(afterFirstTriage.state).toBe("in_review");

      await expect(svc.triage(db, initiativeId)).rejects.toThrow(IllegalTransitionError);
      const afterFailedRetriage = (
        await db.select().from(initiatives).where(eq(initiatives.id, initiativeId))
      )[0]!;
      // Still in_review — the failed second triage() did not partially advance state.
      expect(afterFailedRetriage.state).toBe("in_review");
    });

    it("decide() with an invalid conditionally_approved (no conditions) throws before any write", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);

      await expect(
        svc.decide(db, draft.initiativeId, APPROVER, null, { decision: "conditionally_approved" }),
      ).rejects.toThrow(ValidationError);

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("in_review"); // unchanged
    });
  });

  describe("submitIntake BLOCKING gate", () => {
    it("blocks submission when a BLOCKING rule fails, with no state change", async () => {
      const badPayload: IntakePayload = {
        ...CHAMPION_PREFILL_PAYLOAD,
        basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "" }, // BLK-01 fails
      };
      const draft = await svc.createDraft(db, {
        payload: badPayload,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });

      const result = await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      expect(result.submitted).toBe(false);
      if (result.submitted) throw new Error("unreachable");
      expect(result.gaps.some((g) => g.ruleId === "BLK-01")).toBe(true);

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("intake_draft"); // unchanged — never submitted
    });
  });

  describe("generateEffectiveControls", () => {
    it("throws ValidationError when triage has not run yet", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await expect(svc.generateEffectiveControls(db, draft.initiativeId)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  /* -----------------------------------------------------------------------
   * External-review finding #4 ("live champion workflow stops before
   * control generation"): decide() must call generateEffectiveControls
   * itself, in the SAME transaction as the decision, for approved/
   * conditionally_approved outcomes — a decision recorded with no controls
   * (or vice versa) must never be observable. rejected has nothing to
   * control.
   * -------------------------------------------------------------------- */
  describe("decide() -> effective controls (external-review finding #4: post-decision transition)", () => {
    const DOMAIN_REVIEWER: Record<Domain, { id: string; role: "reviewer" }> = {
      "clinical-safety": { id: "elena-vasquez", role: "reviewer" },
      "privacy-hipaa": { id: "marcus-webb", role: "reviewer" },
      "responsible-ai": { id: "sofia-grant", role: "reviewer" },
      legal: { id: "james-liu", role: "reviewer" },
      security: { id: "devon-clarke", role: "reviewer" },
      "tech-architecture": { id: "wei-zhang", role: "reviewer" },
      "data-governance": { id: "grace-kim", role: "reviewer" },
      procurement: { id: "tom-brennan", role: "reviewer" },
    };

    /** Champion payload, drafted + fully signed across all 8 required domains, ready for decide(). */
    async function setUpSignedInReview(): Promise<{ initiativeId: string; cycleId: string }> {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const triageResult = await svc.triage(db, draft.initiativeId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");
      const rds = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, triageResult.cycleId));
      for (const rd of rds) {
        await db
          .update(reviewDecisions)
          .set({ draftMd: `Draft ${rd.domain}.`, status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
      }
      for (const rd of rds) {
        await svc.signReview(
          db,
          triageResult.cycleId,
          rd.domain as Domain,
          DOMAIN_REVIEWER[rd.domain as Domain],
          null,
        );
      }
      return { initiativeId: draft.initiativeId, cycleId: triageResult.cycleId };
    }

    it("conditionally_approved generates effective_controls + a placeholder deployment atomically with the decision", async () => {
      const { initiativeId } = await setUpSignedInReview();
      const res = await svc.decide(db, initiativeId, APPROVER, null, {
        decision: "conditionally_approved",
        conditions: [{ text: "100% human review.", controlId: "C-01" }],
      });
      expect(res.controlsGenerated).toBeTruthy();
      expect(res.controlsGenerated!.created).toBeGreaterThan(0);

      const deps = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(deps).toHaveLength(1);
      expect(deps[0]!.status).toBe("awaiting_promotion_signoff");
      expect(deps[0]!.id).toBe(res.controlsGenerated!.deploymentId);

      const ecRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deps[0]!.id));
      expect(ecRows).toHaveLength(res.controlsGenerated!.created);

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      expect(events.some((e) => e.action === "effective_controls_generated")).toBe(true);
    });

    it("approved also generates effective controls", async () => {
      const { initiativeId } = await setUpSignedInReview();
      const res = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(res.controlsGenerated).toBeTruthy();
      expect(res.controlsGenerated!.created).toBeGreaterThan(0);
    });

    it("rejected does NOT generate any effective controls or deployment", async () => {
      const { initiativeId } = await setUpSignedInReview();
      const res = await svc.decide(db, initiativeId, APPROVER, null, { decision: "rejected" });
      expect(res.controlsGenerated).toBeUndefined();

      const deps = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(deps).toHaveLength(0);

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      expect(events.some((e) => e.action === "effective_controls_generated")).toBe(false);
    });

    it("a second decide() on a later reassessment cycle increments effective_controls versions on the SAME deployment", async () => {
      const { initiativeId } = await setUpSignedInReview();
      const first = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(first.controlsGenerated).toBeTruthy();
      const deploymentId = first.controlsGenerated!.deploymentId;
      const v1Rows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deploymentId));
      expect(v1Rows.length).toBeGreaterThan(0);
      expect(v1Rows.every((r) => r.version === 1)).toBe(true);

      // Reach a reassessment cycle WITHOUT going through the deploy/pause
      // pipeline — there is no live "deploy" service function in this
      // codebase yet (deploy only exists as a lifecycle-table edge and in
      // seed data), so this directly mirrors what
      // lib/services/monitor-service.ts#runMonitor does for a REAL breach:
      // moves the initiative straight to 're_review' and opens a second
      // review_cycles row of kind 'reassessment' with NO per-domain
      // review_decisions rows (monitor-service.ts doesn't insert any for a
      // reassessment cycle either). Since the P2-6 hardening, decide()'s
      // completeness gate resolves REQUIRED domains from the cycle's risk
      // assessment regardless of which review_decisions rows exist, so a
      // signed row is required for every required domain of THIS
      // reassessment cycle before it will approve — see the
      // "vacuous completeness gate (P2-6)" describe block below for the
      // dedicated missing/zero-row coverage. decide()'s own
      // state-transition/versioning logic is what's under test here, not
      // the completeness gate itself, so the required signed rows are
      // written directly.
      const raRows = await db
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.initiativeId, initiativeId));
      const latestRa = raRows.slice().sort((a, b) => b.version - a.version)[0]!;
      const reassessCycleId = `cycle-reassess-${initiativeId}`;
      await db.insert(reviewCycles).values({
        id: reassessCycleId,
        initiativeId,
        kind: "reassessment",
        riskAssessmentId: latestRa.id,
        openedAt: new Date(Date.now() + 1000), // strictly later than the initial cycle
        closedAt: null,
        incidentId: null,
      });
      await db.update(initiatives).set({ state: "re_review" }).where(eq(initiatives.id, initiativeId));

      for (const domain of latestRa.requiredDomains as Domain[]) {
        await db.insert(reviewDecisions).values({
          id: `rd-reassess-${initiativeId}-${domain}`,
          cycleId: reassessCycleId,
          domain,
          status: "signed",
          reviewer: DOMAIN_REVIEWER[domain].id,
          draftMd: `Reassessment draft ${domain}.`,
          citations: [],
          signedAt: new Date(),
          returnReason: null,
          createdAt: new Date(),
        });
      }

      // re_review only permits the 'approve' action (see lib/lifecycle/transitions.ts).
      const second = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(second.type).toBe("approved");
      expect(second.controlsGenerated).toBeTruthy();
      expect(second.controlsGenerated!.deploymentId).toBe(deploymentId); // same deployment reused, not a new one

      const deps = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(deps).toHaveLength(1); // still just the one deployment

      const allEcRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deploymentId));
      const v2Rows = allEcRows.filter((r) => r.version === 2);
      expect(v2Rows.length).toBe(v1Rows.length);
      expect(v2Rows.map((r) => r.controlId).sort()).toEqual(v1Rows.map((r) => r.controlId).sort());
    });
  });

  /* -----------------------------------------------------------------------
   * External-review finding P2-6 ("vacuous completeness gate"): decide()'s
   * gate used to filter rows that EXIST for the cycle, so a cycle with ZERO
   * review_decisions rows (exactly what a runMonitor-created reassessment
   * cycle is) — or one with rows for only SOME required domains — passed
   * vacuously. A post-breach re_review -> approved needed no signed review
   * at all. Fixed: required domains are resolved from the cycle's risk
   * assessment (falling back to the initiative's latest one), and a missing
   * row for a required domain is blocking, reported as `domain:missing`.
   * -------------------------------------------------------------------- */
  describe("decide() completeness gate resolves required domains from the risk assessment, not existing rows (external-review finding P2-6)", () => {
    const DOMAIN_REVIEWER: Record<Domain, { id: string; role: "reviewer" }> = {
      "clinical-safety": { id: "elena-vasquez", role: "reviewer" },
      "privacy-hipaa": { id: "marcus-webb", role: "reviewer" },
      "responsible-ai": { id: "sofia-grant", role: "reviewer" },
      legal: { id: "james-liu", role: "reviewer" },
      security: { id: "devon-clarke", role: "reviewer" },
      "tech-architecture": { id: "wei-zhang", role: "reviewer" },
      "data-governance": { id: "grace-kim", role: "reviewer" },
      procurement: { id: "tom-brennan", role: "reviewer" },
    };

    /** Champion payload, fully signed + approved once, then a SECOND reassessment
     * cycle opened directly against the DB (mirrors runMonitor's shape: kind
     * 'reassessment', riskAssessmentId set, ZERO review_decisions rows), state
     * forced to 're_review'. Returns the reassessment cycle's required domains
     * (from the initiative's risk assessment) for the caller to populate. */
    async function setUpZeroRowReassessmentCycle(): Promise<{
      initiativeId: string;
      reassessCycleId: string;
      requiredDomains: Domain[];
    }> {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const triageResult = await svc.triage(db, draft.initiativeId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");
      const initiativeId = draft.initiativeId;

      const rds = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, triageResult.cycleId));
      for (const rd of rds) {
        await db
          .update(reviewDecisions)
          .set({ draftMd: `Draft ${rd.domain}.`, status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
      }
      for (const rd of rds) {
        await svc.signReview(
          db,
          triageResult.cycleId,
          rd.domain as Domain,
          DOMAIN_REVIEWER[rd.domain as Domain],
          null,
        );
      }
      const first = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(first.type).toBe("approved");

      const raRows = await db
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.initiativeId, initiativeId));
      const latestRa = raRows.slice().sort((a, b) => b.version - a.version)[0]!;
      const reassessCycleId = `cycle-p26-${initiativeId}`;
      await db.insert(reviewCycles).values({
        id: reassessCycleId,
        initiativeId,
        kind: "reassessment",
        riskAssessmentId: latestRa.id,
        openedAt: new Date(Date.now() + 1000),
        closedAt: null,
        incidentId: null,
      });
      await db.update(initiatives).set({ state: "re_review" }).where(eq(initiatives.id, initiativeId));

      return { initiativeId, reassessCycleId, requiredDomains: latestRa.requiredDomains as Domain[] };
    }

    it("a reassessment cycle with ZERO review_decisions rows throws ValidationError listing every required domain as missing", async () => {
      const { initiativeId, requiredDomains } = await setUpZeroRowReassessmentCycle();

      let caught: unknown;
      try {
        await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      for (const domain of requiredDomains) {
        expect((caught as Error).message).toContain(`${domain}:missing`);
      }

      // No partial write from the blocked attempt.
      const row = (await db.select().from(initiatives).where(eq(initiatives.id, initiativeId)))[0]!;
      expect(row.state).toBe("re_review");
    });

    it("a reassessment cycle missing just ONE required domain's row is blocked, naming it as missing", async () => {
      const { initiativeId, reassessCycleId, requiredDomains } = await setUpZeroRowReassessmentCycle();
      const [missingDomain, ...restDomains] = requiredDomains;

      for (const domain of restDomains) {
        await db.insert(reviewDecisions).values({
          id: `rd-p26-${initiativeId}-${domain}`,
          cycleId: reassessCycleId,
          domain,
          status: "signed",
          reviewer: DOMAIN_REVIEWER[domain].id,
          draftMd: `Reassessment draft ${domain}.`,
          citations: [],
          signedAt: new Date(),
          returnReason: null,
          createdAt: new Date(),
        });
      }

      let caught: unknown;
      try {
        await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as Error).message).toContain(`${missingDomain}:missing`);
    });

    it("a reassessment cycle with every required domain signed approves (stays green on the happy path)", async () => {
      const { initiativeId, reassessCycleId, requiredDomains } = await setUpZeroRowReassessmentCycle();

      for (const domain of requiredDomains) {
        await db.insert(reviewDecisions).values({
          id: `rd-p26-ok-${initiativeId}-${domain}`,
          cycleId: reassessCycleId,
          domain,
          status: "signed",
          reviewer: DOMAIN_REVIEWER[domain].id,
          draftMd: `Reassessment draft ${domain}.`,
          citations: [],
          signedAt: new Date(),
          returnReason: null,
          createdAt: new Date(),
        });
      }

      const res = await svc.decide(db, initiativeId, APPROVER, null, { decision: "approved" });
      expect(res.type).toBe("approved");
    });

    it("the fast-lane branch (triage()'s own initiative_decisions write) is never routed through decide()'s gate", async () => {
      // Fast-lane eligible: low tier, no PHI/member-facing/care-coverage
      // flags (mirrors seed #2 marketing-ab-tester — see lowTierPayload()).
      const draft = await svc.createDraft(db, {
        payload: lowTierPayload(),
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const result = await svc.triage(db, draft.initiativeId);
      expect(result.branch).toBe("fast-lane");

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("fast_lane_approved");
      const decisions = await db
        .select()
        .from(initiativeDecisions)
        .where(eq(initiativeDecisions.initiativeId, draft.initiativeId));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.type).toBe("fast_lane_approved");
    });
  });

  describe("system actor default for triage()", () => {
    it("defaults actor to system when omitted", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const result = await svc.triage(db, draft.initiativeId);
      expect(result.tier).toBe("critical");

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.initiativeId, draft.initiativeId));
      const triageEvent = events.find((e) => e.action === "triage");
      expect(triageEvent?.actor).toBe(SYSTEM_ACTOR.id);
    });
  });

  describe("createDraft workspace tagging (M2.5 inc.2a foundation)", () => {
    it("persists the passed workspaceId on the created initiative row", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
        workspaceId: "ws_test_123",
      });

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.workspaceId).toBe("ws_test_123");
    });

    it("defaults to a null workspaceId when omitted (non-breaking / seeded-style creation)", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });

      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.workspaceId).toBeNull();
    });
  });

  /* -----------------------------------------------------------------------
   * Security-hardening pass — external-review finding #1: workspace
   * isolation is not an authorization boundary on mutations. decide() and
   * signReview() now resolve the target initiative's workspace inside their
   * transaction and enforce it against the caller's session workspace.
   * -------------------------------------------------------------------- */
  describe("workspace authorization on mutations (external-review finding #1)", () => {
    describe("submitIntake() / triage()", () => {
      it("submitIntake checks workspace before requester ownership or lifecycle state", async () => {
        const draft = await svc.createDraft(db, {
          payload: CHAMPION_PREFILL_PAYLOAD,
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId: "ws-A",
        });
        await db
          .update(initiatives)
          .set({ state: "deployed" })
          .where(eq(initiatives.id, draft.initiativeId));

        const OTHER_REQUESTER = { id: "dan-kowalski", role: "requester" as const };
        await expect(
          svc.submitIntake(db, draft.initiativeId, OTHER_REQUESTER, "ws-B"),
        ).rejects.toThrow(NotFoundError);
        await expect(
          svc.submitIntake(db, draft.initiativeId, OTHER_REQUESTER, "ws-B"),
        ).rejects.toThrow(`initiative not found: ${draft.initiativeId}`);
      });

      it("submitIntake allows the owning workspace and any workspace for a null-workspace initiative", async () => {
        const owned = await svc.createDraft(db, {
          payload: CHAMPION_PREFILL_PAYLOAD,
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId: "ws-A",
        });
        await expect(
          svc.submitIntake(db, owned.initiativeId, REQUESTER, "ws-A"),
        ).resolves.toMatchObject({ submitted: true });

        const seededStyle = await svc.createDraft(db, {
          payload: { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Shared intake" } },
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId: null,
        });
        await expect(
          svc.submitIntake(db, seededStyle.initiativeId, REQUESTER, "ws-any"),
        ).resolves.toMatchObject({ submitted: true });
      });

      it("triage checks workspace before lifecycle validation, and permits owner/null-workspace calls", async () => {
        const foreignWrongState = await svc.createDraft(db, {
          payload: CHAMPION_PREFILL_PAYLOAD,
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId: "ws-A",
        });
        await expect(
          svc.triage(db, foreignWrongState.initiativeId, SYSTEM_ACTOR, "ws-B"),
        ).rejects.toThrow(NotFoundError);

        await svc.submitIntake(db, foreignWrongState.initiativeId, REQUESTER, "ws-A");
        await expect(
          svc.triage(db, foreignWrongState.initiativeId, SYSTEM_ACTOR, "ws-A"),
        ).resolves.toMatchObject({ branch: "review" });

        const seededStyle = await svc.createDraft(db, {
          payload: { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Shared triage" } },
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId: null,
        });
        await svc.submitIntake(db, seededStyle.initiativeId, REQUESTER, "ws-any");
        await expect(
          svc.triage(db, seededStyle.initiativeId, SYSTEM_ACTOR, "ws-any"),
        ).resolves.toMatchObject({ branch: "review" });
      });
    });

    async function initiativeReadyToDecide(
      workspaceId: string | null,
    ): Promise<{ initiativeId: string; cycleId: string }> {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
        workspaceId,
      });
      // submitIntake()/triage() now ALSO enforce workspace authorization
      // (external-review finding P2-4) — pass the SAME workspaceId this
      // initiative was created with, matching how a real same-browser
      // session would carry it through the whole flow.
      await svc.submitIntake(db, draft.initiativeId, REQUESTER, workspaceId);
      const triageResult = await svc.triage(db, draft.initiativeId, SYSTEM_ACTOR, workspaceId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");
      return { initiativeId: draft.initiativeId, cycleId: triageResult.cycleId };
    }

    describe("decide()", () => {
      it("a session bound to a DIFFERENT workspace gets NotFoundError — same shape as an unknown id", async () => {
        const { initiativeId } = await initiativeReadyToDecide("ws-A");
        await expect(
          svc.decide(db, initiativeId, APPROVER, "ws-B", { decision: "rejected" }),
        ).rejects.toThrow(NotFoundError);
        await expect(
          svc.decide(db, initiativeId, APPROVER, "ws-B", { decision: "rejected" }),
        ).rejects.toThrow(`initiative not found: ${initiativeId}`);
      });

      it("a session bound to the OWNING workspace succeeds", async () => {
        const { initiativeId } = await initiativeReadyToDecide("ws-A");
        const res = await svc.decide(db, initiativeId, APPROVER, "ws-A", { decision: "rejected" });
        expect(res.type).toBe("rejected");
      });

      it("a session with a NULL workspace cannot decide a workspace-tagged initiative", async () => {
        const { initiativeId } = await initiativeReadyToDecide("ws-A");
        await expect(
          svc.decide(db, initiativeId, APPROVER, null, { decision: "rejected" }),
        ).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) initiative is decidable from ANY session workspace", async () => {
        const { initiativeId } = await initiativeReadyToDecide(null);
        const res = await svc.decide(db, initiativeId, APPROVER, "ws-anything-at-all", {
          decision: "rejected",
        });
        expect(res.type).toBe("rejected");
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const { initiativeId } = await initiativeReadyToDecide("ws-A");
        await expect(
          svc.decide(db, initiativeId, APPROVER, "ws-B", { decision: "rejected" }),
        ).rejects.toThrow(NotFoundError);
        const row = (await db.select().from(initiatives).where(eq(initiatives.id, initiativeId)))[0]!;
        expect(row.state).toBe("in_review"); // unchanged
        const decisions = await db
          .select()
          .from(initiativeDecisions)
          .where(eq(initiativeDecisions.initiativeId, initiativeId));
        expect(decisions).toHaveLength(0);
      });
    });

    /* ---------------------------------------------------------------------
     * External-review finding P2-4: submitIntake()/triage() never received
     * the session workspace, unlike decide()/signReview()/returnReview()/
     * runReviewAgent() above — any authenticated demo session could submit
     * or triage another workspace's live-created initiative by id. Same
     * guard (`assertWorkspaceAccess`), same NotFoundError shape as an
     * unknown id — no existence leak.
     * -------------------------------------------------------------------- */
    describe("submitIntake()", () => {
      async function draftInWorkspace(workspaceId: string | null) {
        return svc.createDraft(db, {
          payload: CHAMPION_PREFILL_PAYLOAD,
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId,
        });
      }

      it("a session bound to a DIFFERENT workspace gets NotFoundError — same shape as an unknown id", async () => {
        const draft = await draftInWorkspace("ws-A");
        await expect(svc.submitIntake(db, draft.initiativeId, REQUESTER, "ws-B")).rejects.toThrow(
          NotFoundError,
        );
        await expect(svc.submitIntake(db, draft.initiativeId, REQUESTER, "ws-B")).rejects.toThrow(
          `initiative not found: ${draft.initiativeId}`,
        );
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const draft = await draftInWorkspace("ws-A");
        await expect(svc.submitIntake(db, draft.initiativeId, REQUESTER, "ws-B")).rejects.toThrow(
          NotFoundError,
        );
        const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
        expect(row.state).toBe("intake_draft"); // unchanged
      });

      it("a session bound to the OWNING workspace succeeds", async () => {
        const draft = await draftInWorkspace("ws-A");
        const res = await svc.submitIntake(db, draft.initiativeId, REQUESTER, "ws-A");
        expect(res.submitted).toBe(true);
      });

      it("a session with a NULL workspace cannot submit a workspace-tagged initiative", async () => {
        const draft = await draftInWorkspace("ws-A");
        await expect(svc.submitIntake(db, draft.initiativeId, REQUESTER, null)).rejects.toThrow(
          NotFoundError,
        );
      });

      it("a seeded (null-workspace) initiative is submittable from ANY session workspace", async () => {
        const draft = await draftInWorkspace(null);
        const res = await svc.submitIntake(db, draft.initiativeId, REQUESTER, "ws-anything-at-all");
        expect(res.submitted).toBe(true);
      });
    });

    describe("triage()", () => {
      async function submittedInWorkspace(workspaceId: string | null): Promise<string> {
        const draft = await svc.createDraft(db, {
          payload: CHAMPION_PREFILL_PAYLOAD,
          requesterActor: REQUESTER,
          requesterName: "Priya Raman",
          workspaceId,
        });
        await svc.submitIntake(db, draft.initiativeId, REQUESTER, workspaceId);
        return draft.initiativeId;
      }

      it("a session bound to a DIFFERENT workspace gets NotFoundError — same shape as an unknown id", async () => {
        const initiativeId = await submittedInWorkspace("ws-A");
        await expect(svc.triage(db, initiativeId, SYSTEM_ACTOR, "ws-B")).rejects.toThrow(NotFoundError);
        await expect(svc.triage(db, initiativeId, SYSTEM_ACTOR, "ws-B")).rejects.toThrow(
          `initiative not found: ${initiativeId}`,
        );
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const initiativeId = await submittedInWorkspace("ws-A");
        await expect(svc.triage(db, initiativeId, SYSTEM_ACTOR, "ws-B")).rejects.toThrow(NotFoundError);
        const row = (await db.select().from(initiatives).where(eq(initiatives.id, initiativeId)))[0]!;
        expect(row.state).toBe("submitted"); // unchanged
        const raRows = await db
          .select()
          .from(riskAssessments)
          .where(eq(riskAssessments.initiativeId, initiativeId));
        expect(raRows).toHaveLength(0);
      });

      it("a session bound to the OWNING workspace succeeds", async () => {
        const initiativeId = await submittedInWorkspace("ws-A");
        const res = await svc.triage(db, initiativeId, SYSTEM_ACTOR, "ws-A");
        expect(res.tier).toBe("critical");
      });

      it("a session with a NULL workspace cannot triage a workspace-tagged initiative", async () => {
        const initiativeId = await submittedInWorkspace("ws-A");
        await expect(svc.triage(db, initiativeId, SYSTEM_ACTOR, null)).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) initiative is triageable from ANY session workspace", async () => {
        const initiativeId = await submittedInWorkspace(null);
        const res = await svc.triage(db, initiativeId, SYSTEM_ACTOR, "ws-anything-at-all");
        expect(res.tier).toBe("critical");
      });
    });

    describe("signReview()", () => {
      async function draftedClinicalSafety(cycleId: string): Promise<string> {
        const rows = await db
          .select()
          .from(reviewDecisions)
          .where(eq(reviewDecisions.cycleId, cycleId));
        const rd = rows.find((r) => r.domain === "clinical-safety")!;
        await db
          .update(reviewDecisions)
          .set({ draftMd: "Draft clinical-safety.", status: "drafted" })
          .where(eq(reviewDecisions.id, rd.id));
        return rd.id;
      }

      it("a session bound to a DIFFERENT workspace gets NotFoundError", async () => {
        const { cycleId } = await initiativeReadyToDecide("ws-A");
        await draftedClinicalSafety(cycleId);
        await expect(
          svc.signReview(db, cycleId, "clinical-safety", REVIEWER, "ws-B"),
        ).rejects.toThrow(NotFoundError);
      });

      it("a session bound to the OWNING workspace succeeds", async () => {
        const { cycleId } = await initiativeReadyToDecide("ws-A");
        await draftedClinicalSafety(cycleId);
        const res = await svc.signReview(db, cycleId, "clinical-safety", REVIEWER, "ws-A");
        expect(res.status).toBe("signed");
      });

      it("a NULL-workspace session cannot sign a workspace-tagged review", async () => {
        const { cycleId } = await initiativeReadyToDecide("ws-A");
        await draftedClinicalSafety(cycleId);
        await expect(
          svc.signReview(db, cycleId, "clinical-safety", REVIEWER, null),
        ).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) review is signable from ANY session workspace", async () => {
        const { cycleId } = await initiativeReadyToDecide(null);
        const rdId = await draftedClinicalSafety(cycleId);
        const res = await svc.signReview(db, cycleId, "clinical-safety", REVIEWER, "ws-anything");
        expect(res.status).toBe("signed");
        const row = (await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, rdId)))[0]!;
        expect(row.status).toBe("signed");
      });
    });
  });

  /* -----------------------------------------------------------------------
   * Security-hardening pass — external-review finding #3: governance
   * transitions race under concurrency. decide()/signReview() now do
   * compare-and-set (CAS) updates instead of blind read-then-write, and
   * initiative_decisions has a unique (cycle_id) index (migration 0006).
   *
   * PGlite is effectively single-connection (verified empirically: firing
   * two decide()/signReview() calls via Promise.all fully serializes them —
   * the second call's own fresh read already observes the first call's
   * committed write, so it is rejected by the PRE-EXISTING transition()/
   * "already signed" guards before ever reaching the new CAS code). True
   * overlapping transactions aren't reproducible in this environment, so
   * the CAS-triggering tests below simulate the race deterministically by
   * injecting a same-transaction write (via `tx`) between decide()/
   * signReview()'s own read and its CAS update — this reproduces the exact
   * DB-visible effect a genuinely concurrent committed write would have
   * (the predicate no longer matches), without relying on nondeterministic
   * true parallelism.
   * -------------------------------------------------------------------- */
  describe("concurrency: compare-and-set + unique constraint (external-review finding #3)", () => {
    it("initiative_decisions_cycle_uq: a second row for the same cycle violates the unique index", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const triageResult = await svc.triage(db, draft.initiativeId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");

      await db.insert(initiativeDecisions).values({
        id: "decision-first",
        initiativeId: draft.initiativeId,
        cycleId: triageResult.cycleId,
        type: "rejected",
        approver: APPROVER.id,
        policyId: null,
        citations: [],
        conditions: [],
        decidedAt: new Date(),
      });

      await expect(
        db.insert(initiativeDecisions).values({
          id: "decision-second",
          initiativeId: draft.initiativeId,
          cycleId: triageResult.cycleId,
          type: "approved",
          approver: APPROVER.id,
          policyId: null,
          citations: [],
          conditions: [],
          decidedAt: new Date(),
        }),
      ).rejects.toThrow();
    });

    it("decide() called twice sequentially on the same cycle: the second is rejected and no second decision row is written", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);

      const first = await svc.decide(db, draft.initiativeId, APPROVER, null, { decision: "rejected" });
      expect(first.type).toBe("rejected");

      // The second call's own fresh read already sees the first call's
      // committed 'rejected' state, so transition() rejects it before any
      // write is attempted (IllegalTransitionError) — one of the two
      // documented acceptable outcomes for this scenario alongside
      // ConflictError. The safety property under test either way: no
      // second initiative_decisions row.
      await expect(
        svc.decide(db, draft.initiativeId, APPROVER, null, { decision: "rejected" }),
      ).rejects.toThrow(IllegalTransitionError);

      const decisions = await db
        .select()
        .from(initiativeDecisions)
        .where(eq(initiativeDecisions.initiativeId, draft.initiativeId));
      expect(decisions).toHaveLength(1);
    });

    it("decide(): a write that lands between this transaction's read and its CAS update throws ConflictError, and the whole transaction rolls back", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      await svc.triage(db, draft.initiativeId);

      // Test-only same-transaction write injection (see file-level comment
      // above): the mock surface (a live Drizzle transaction-scoped query
      // builder chain) isn't meaningfully typeable, so this block is `any`
      // throughout by design, not an oversight.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === initiatives) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent writer: flips the initiative's
                    // state directly, inside the SAME transaction, between
                    // decide()'s own read (captured as `initiative.state`)
                    // and its CAS update below — reproducing the DB-visible
                    // effect of another transaction's commit landing in
                    // that window.
                    await realUpdate(initiatives)
                      .set({ state: "rejected" })
                      .where(eq(initiatives.id, draft.initiativeId));
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
        await svc.decide(db, draft.initiativeId, APPROVER, null, { decision: "rejected" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as Error).message).toContain("changed concurrently");

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write.
      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("in_review");
      const decisions = await db
        .select()
        .from(initiativeDecisions)
        .where(eq(initiativeDecisions.initiativeId, draft.initiativeId));
      expect(decisions).toHaveLength(0);
    });

    it("signReview(): a write that lands between this transaction's read and its CAS update throws ConflictError, and the whole transaction rolls back", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      const triageResult = await svc.triage(db, draft.initiativeId);
      if (triageResult.branch !== "review") throw new Error("expected review branch");
      const rows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, triageResult.cycleId));
      const rd = rows.find((r) => r.domain === "clinical-safety")!;
      await db
        .update(reviewDecisions)
        .set({ draftMd: "Draft.", status: "drafted" })
        .where(eq(reviewDecisions.id, rd.id));

      // Test-only same-transaction write injection — see the decide() CAS
      // test above for the full rationale; `any`-typed by design.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === reviewDecisions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realReturning = base.returning.bind(base);
                base.returning = async (...args: unknown[]) => {
                  // Simulated concurrent writer: returns the review
                  // (changing its status) between signReview()'s own read
                  // (captured as `decision.status`) and its CAS update.
                  await realUpdate(reviewDecisions)
                    .set({ status: "returned", returnReason: "simulated concurrent write" })
                    .where(eq(reviewDecisions.id, rd.id));
                  return realReturning(...args);
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
        await svc.signReview(db, triageResult.cycleId, "clinical-safety", REVIEWER, null);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as Error).message).toContain("changed concurrently");

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write; the
      // row is back to its pre-transaction 'drafted' state, not 'signed'
      // AND not 'returned'.
      const finalRow = (
        await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, rd.id))
      )[0]!;
      expect(finalRow.status).toBe("drafted");
    });

    /* -----------------------------------------------------------------------
     * External-review finding P2-5a: updateInitiativeState() was a plain
     * `where(eq(id))` update, used by submitIntake()/triage() — two
     * concurrent triage() calls both reading 'submitted' would both pass and
     * both write, each creating its OWN risk_assessments/review_cycles rows
     * (the 0006 unique index doesn't stop it: different cycleIds). Same
     * write-injection technique as the decide()/signReview() tests above.
     * -------------------------------------------------------------------- */
    it("submitIntake(): a write that lands between this transaction's read and its CAS update throws ConflictError, and the whole transaction rolls back", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === initiatives) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent second submitIntake()/triage()
                    // call: flips the initiative's state directly, between
                    // THIS submitIntake()'s own read ('intake_draft') and
                    // its CAS update below.
                    await realUpdate(initiatives)
                      .set({ state: "triaged" })
                      .where(eq(initiatives.id, draft.initiativeId));
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
        await svc.submitIntake(db, draft.initiativeId, REQUESTER);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as Error).message).toContain("changed concurrently");

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write — back
      // to the pre-transaction 'intake_draft' state.
      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("intake_draft");
    });

    it("triage(): a write that lands between this transaction's read and its first CAS update throws ConflictError, and the whole transaction rolls back — no duplicate risk assessment or review cycle", async () => {
      const draft = await svc.createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
      });
      await svc.submitIntake(db, draft.initiativeId, REQUESTER);

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          let injected = false;
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            // Only intercept the FIRST `initiatives` update in this
            // transaction (triage()'s submitted->triaged transition, which
            // happens before any risk_assessments/review_cycles writes) —
            // triage() may issue up to two more `initiatives` updates later
            // in the SAME transaction (fast-lane/start_review branches)
            // which must run unmodified once the race has been reproduced.
            if (table === initiatives && !injected) {
              injected = true;
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent second triage() call: flips the
                    // initiative's state directly, between THIS triage()'s
                    // own read ('submitted') and its first CAS update below.
                    await realUpdate(initiatives)
                      .set({ state: "triaged" })
                      .where(eq(initiatives.id, draft.initiativeId));
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
        await svc.triage(db, draft.initiativeId);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as Error).message).toContain("changed concurrently");

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write — back
      // to the pre-transaction 'submitted' state, and no risk_assessments/
      // review_cycles rows from the "losing" call.
      const row = (await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId)))[0]!;
      expect(row.state).toBe("submitted");
      const raRows = await db
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.initiativeId, draft.initiativeId));
      expect(raRows).toHaveLength(0);
      const cycleRows = await db
        .select()
        .from(reviewCycles)
        .where(eq(reviewCycles.initiativeId, draft.initiativeId));
      expect(cycleRows).toHaveLength(0);
    });
  });
});
