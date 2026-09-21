/**
 * Tests for lib/services/admin-service.ts (task brief deliverable 2 + 4):
 * the two live admin actions (threshold change, pause/resume), both
 * admin-only + reason-required, both writing before/after AuditEvents. Also
 * pins that an admin actor attempting `decide()` (approve/reject) via
 * initiative-service is rejected — separation of duties enforced from the
 * admin surface, not just initiative-service's own test file.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase, BASE_DATE_MS } from "../../scripts/seed";
import { auditEvents, controlDefinitions, deploymentVersions, effectiveControls, incidents, initiativeDecisions, initiatives, reviewCycles, reviewDecisions } from "../db/schema";
import {
  setEvalThreshold,
  pauseDeployment,
  resumeDeployment,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from "./admin-service";
import { runMonitor, UNSCOPED_WORKSPACE } from "./monitor-service";
import { IllegalTransitionError, decide, createDraft, runReviewAgent, signReview } from "./initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { ACTOR_DIRECTORY } from "./actors";
import type { Domain } from "../domain/types";
import { reviewDraftToken } from "../workflow/review-draft-token";

// Admin/domain tests never initialize a live SDK, regardless of host credentials.
vi.mock("../agents", async () => {
  const { createMockAgentPort } = await import("../agents/mock-adapter");
  return { getAgentPort: () => createMockAgentPort() };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const PLUS_14D = BASE_DATE_MS + 14 * DAY_MS;

const RAY_CHEN = { id: "ray-chen", role: "admin" as const };
const REQUESTER = { id: "priya-raman", role: "requester" as const };
const APPROVER = { id: "angela-torres", role: "approver" as const };

async function memberChatCopilotId(db: TestDb): Promise<string> {
  const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
  return init!.id;
}

describe("lib/services/admin-service", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  describe("setEvalThreshold — project override", () => {
    it("updates only the current control revision on the operational deployment when a newer candidate exists", async () => {
      const initiativeId = await memberChatCopilotId(db);
      const [deployed] = await db.select().from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      const controls = await db.select().from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, deployed!.id));
      const original = controls.find((control) => control.controlId === "Q-01")!;
      const currentId = `ec-${randomUUID()}`;
      const candidateId = `dep-${randomUUID()}`;
      const candidateControlId = `ec-${randomUUID()}`;
      await db.insert(deploymentVersions).values({
        ...deployed!,
        id: candidateId,
        version: "v-next",
        status: "awaiting_promotion_signoff",
        deployedAt: new Date(deployed!.deployedAt.getTime() + DAY_MS),
      });
      await db.insert(effectiveControls).values([
        { ...original, id: currentId, version: original.version + 1, thresholdOverride: 0.07 },
        { ...original, id: candidateControlId, deploymentId: candidateId, thresholdOverride: 0.12 },
      ]);

      const result = await setEvalThreshold(db, RAY_CHEN, null, {
        controlId: "Q-01", initiativeId, newValue: 0.06, reason: "Tighten the active control.",
      });

      expect(result.before).toBe(0.07);
      const [current] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, currentId));
      const [history] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, original.id));
      const [candidate] = await db.select().from(effectiveControls).where(eq(effectiveControls.id, candidateControlId));
      expect(current!.thresholdOverride).toBe(0.06);
      expect(history!.thresholdOverride).toBe(original.thresholdOverride);
      expect(candidate!.thresholdOverride).toBe(0.12);
      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      expect(events.find((event) => event.action === "control_threshold_changed")).toMatchObject({
        before: "0.07", after: "0.06", actor: RAY_CHEN.id,
      });
    });

    it("writes a threshold override for the initiative's deployment + a before/after audit event", async () => {
      const initiativeId = await memberChatCopilotId(db);

      const result = await setEvalThreshold(db, RAY_CHEN, null, {
        controlId: "Q-01",
        initiativeId,
        newValue: 0.06,
        reason: "Post-breach tightening, high member visibility.",
      });

      expect(result.scope).toBe("project-override");
      expect(result.after).toBe(0.06);
      expect(result.before).toBeNull(); // no override set at seed time

      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const ecRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, dep!.id));
      const q01 = ecRows.filter((e) => e.controlId === "Q-01").sort((a, b) => b.version - a.version)[0];
      expect(q01!.thresholdOverride).toBe(0.06);

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const changeEvent = events.find((e) => e.action === "control_threshold_changed");
      expect(changeEvent).toBeTruthy();
      expect(changeEvent!.before).toBeNull();
      expect(changeEvent!.after).toBe("0.06");
      expect(changeEvent!.actor).toBe("ray-chen");
      expect(changeEvent!.detail).toContain("Post-breach tightening");
    });

    it("a subsequent runMonitor with the tightened threshold (0.06) breaches EARLIER than the default (0.08)", async () => {
      const initiativeId = await memberChatCopilotId(db);

      // At the default threshold (0.08), base+8d does not yet breach.
      const beforeTighten = await runMonitor(
        db,
        RAY_CHEN,
        BASE_DATE_MS + 8 * DAY_MS,
        UNSCOPED_WORKSPACE,
      );
      const [depBefore] = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(beforeTighten.breaches.find((b) => b.deploymentId === depBefore!.id)).toBeUndefined();

      // Tighten to 0.06 — the ramp (0.045 + 0.0035*day) crosses 0.06 much
      // earlier than 0.08, so the SAME base+8d nowTs now breaches.
      await setEvalThreshold(db, RAY_CHEN, null, {
        controlId: "Q-01",
        initiativeId,
        newValue: 0.06,
        reason: "Tighten ahead of schedule.",
      });

      const afterTighten = await runMonitor(
        db,
        RAY_CHEN,
        BASE_DATE_MS + 8 * DAY_MS,
        UNSCOPED_WORKSPACE,
      );
      const [depAfter] = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      const breach = afterTighten.breaches.find((b) => b.deploymentId === depAfter!.id);
      expect(breach).toBeTruthy();
      expect(breach!.threshold).toBe(0.06);
      expect(breach!.isNew).toBe(true);
    });

    it("requires role=admin — a non-admin actor is rejected", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(
        setEvalThreshold(db, REQUESTER, null, {
          controlId: "Q-01",
          initiativeId,
          newValue: 0.06,
          reason: "not admin",
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("requires a non-empty reason", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(
        setEvalThreshold(db, RAY_CHEN, null, { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "" }),
      ).rejects.toThrow(ValidationError);
    });

    it("tier-default change (initiativeId=null) updates control_definitions.tier_default_thresholds for the named tier", async () => {
      const result = await setEvalThreshold(db, RAY_CHEN, null, {
        controlId: "Q-01",
        initiativeId: null,
        tier: "critical",
        newValue: 0.04,
        reason: "Critical-tier tightening.",
      });
      expect(result.scope).toBe("tier-default");
      expect(result.before).toBe(0.05);
      expect(result.after).toBe(0.04);

      const [def] = await db.select().from(controlDefinitions).where(eq(controlDefinitions.id, "Q-01"));
      const defaults = def!.tierDefaultThresholds as Record<string, number>;
      expect(defaults.critical).toBe(0.04);
      expect(defaults.high).toBe(0.08); // other tiers untouched
    });

    it("returns NotFoundError for a foreign project before loading its deployment/control", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await db
        .update(initiatives)
        .set({ workspaceId: "ws-A" })
        .where(eq(initiatives.id, initiativeId));

      await expect(
        setEvalThreshold(
          db,
          RAY_CHEN,
          "ws-B",
          {
            controlId: "Q-01",
            initiativeId,
            newValue: 0.06,
            reason: "foreign attempt",
          },
        ),
      ).rejects.toThrow(NotFoundError);
      await expect(
        setEvalThreshold(
          db,
          RAY_CHEN,
          "ws-B",
          {
            controlId: "Q-01",
            initiativeId,
            newValue: 0.06,
            reason: "foreign attempt",
          },
        ),
      ).rejects.toThrow(`initiative not found: ${initiativeId}`);
      await expect(
        setEvalThreshold(
          db,
          RAY_CHEN,
          "ws-A",
          {
            controlId: "Q-01",
            initiativeId,
            newValue: 0.06,
            reason: "owner override",
          },
        ),
      ).resolves.toMatchObject({ scope: "project-override", after: 0.06 });
    });
  });

  describe("pauseDeployment / resumeDeployment", () => {
    it("pauses and resumes the operational version without changing the newer seeded promotion candidate", async () => {
      const [initiative] = await db.select().from(initiatives)
        .where(eq(initiatives.slug, "pa-correspondence-model"));
      const versions = await db.select().from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiative!.id));
      const deployed = versions.find((version) => version.status === "deployed")!;
      const candidate = versions.find((version) => version.status === "awaiting_promotion_signoff")!;

      const paused = await pauseDeployment(db, RAY_CHEN, null, initiative!.id, "Pause the active release.");
      expect(paused.deploymentId).toBe(deployed.id);
      const [pausedVersion] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, deployed.id));
      expect(pausedVersion!.status).toBe("paused");
      const resumed = await resumeDeployment(db, RAY_CHEN, null, initiative!.id, "Resume the active release.");
      expect(resumed.deploymentId).toBe(deployed.id);

      const [unchangedCandidate] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, candidate.id));
      expect(unchangedCandidate).toEqual(candidate);
      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiative!.id));
      for (const action of ["pause", "resume"]) {
        expect(events.find((event) => event.action === action)?.metadata).toMatchObject({ deploymentId: deployed.id });
      }
    });

    it.each(["awaiting_promotion_signoff", "retired"])(
      "rejects operational mutations when only a %s version remains",
      async (status) => {
        const initiativeId = await memberChatCopilotId(db);
        await db.update(deploymentVersions).set({ status }).where(eq(deploymentVersions.initiativeId, initiativeId));
        const beforeEvents = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
        const beforeControls = await db.select().from(effectiveControls);
        const beforeVersions = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));

        await expect(pauseDeployment(db, RAY_CHEN, null, initiativeId, "No active release.")).rejects.toThrow(NotFoundError);
        await expect(setEvalThreshold(db, RAY_CHEN, null, {
          controlId: "Q-01", initiativeId, newValue: 0.06, reason: "No active release.",
        })).rejects.toThrow(NotFoundError);
        await db.update(initiatives).set({ state: "paused" }).where(eq(initiatives.id, initiativeId));
        await expect(resumeDeployment(db, RAY_CHEN, null, initiativeId, "No active release.")).rejects.toThrow(NotFoundError);

        expect(await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId))).toEqual(beforeVersions);
        expect(await db.select().from(effectiveControls)).toEqual(beforeControls);
        expect(await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId))).toEqual(beforeEvents);
      },
    );

    it("pauseDeployment requires a non-empty reason (rejects empty string)", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(pauseDeployment(db, RAY_CHEN, null, initiativeId, "")).rejects.toThrow(ValidationError);
    });

    it("pauseDeployment requires role=admin", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(pauseDeployment(db, REQUESTER, null, initiativeId, "some reason")).rejects.toThrow(ForbiddenError);
    });

    it("pauseDeployment transitions deployed -> paused with an audit event", async () => {
      const initiativeId = await memberChatCopilotId(db);
      const result = await pauseDeployment(db, RAY_CHEN, null, initiativeId, "Manual pause for maintenance.");
      expect(result.before).toBe("deployed");
      expect(result.after).toBe("paused");

      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("paused");
      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(dep!.status).toBe("paused");
      expect(dep!.pausedAt).not.toBeNull();

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const pauseEvent = events.find((e) => e.action === "pause");
      expect(pauseEvent).toBeTruthy();
      expect(pauseEvent!.before).toBe("deployed");
      expect(pauseEvent!.after).toBe("paused");
    });

    it("resumeDeployment restores deployed from paused with an audit event", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await pauseDeployment(db, RAY_CHEN, null, initiativeId, "Manual pause for maintenance.");

      const result = await resumeDeployment(db, RAY_CHEN, null, initiativeId, "Maintenance complete.");
      expect(result.before).toBe("paused");
      expect(result.after).toBe("deployed");

      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("deployed");
      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(dep!.status).toBe("deployed");
      expect(dep!.pausedAt).toBeNull();

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const resumeEvent = events.find((e) => e.action === "resume");
      expect(resumeEvent).toBeTruthy();
    });

    it("resumeDeployment requires a non-empty reason", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await pauseDeployment(db, RAY_CHEN, null, initiativeId, "Manual pause for maintenance.");
      await expect(resumeDeployment(db, RAY_CHEN, null, initiativeId, "")).rejects.toThrow(ValidationError);
    });

    it("resumeDeployment also restores a re_review (post-breach reassessment) initiative to deployed", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await runMonitor(db, RAY_CHEN, PLUS_14D, UNSCOPED_WORKSPACE);
      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("re_review");

      const result = await resumeDeployment(db, RAY_CHEN, null, initiativeId, "Reassessment complete, model retrained.");
      expect(result.after).toBe("deployed");
    });

    it("resumes only by explicit admin action after monitor, domain drafts/signatures, and reassessment approval", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await db.update(initiatives).set({ workspaceId: "ws-reassessment" }).where(eq(initiatives.id, initiativeId));
      const [deployment] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const monitor = await runMonitor(db, RAY_CHEN, PLUS_14D, "ws-reassessment");
      const breach = monitor.breaches.find((row) => row.deploymentId === deployment.id)!;
      const reviewCycleId = breach.reviewCycleId;
      if (!reviewCycleId) throw new Error("the breach must open a reassessment cycle");
      const pending = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, reviewCycleId));
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((row) => row.status === "pending")).toBe(true);
      for (const review of pending) {
        const reviewer = Object.values(ACTOR_DIRECTORY).find((persona) => persona.reviewDomain === review.domain)!;
        const actor = { id: reviewer.id, role: "reviewer" as const };
        expect(await runReviewAgent(db, reviewCycleId, review.domain as Domain, actor, "ws-reassessment"))
          .toMatchObject({ status: "drafted" });
        const [drafted] = await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, review.id));
        await signReview(db, reviewCycleId, review.domain as Domain, actor, "ws-reassessment", undefined, reviewDraftToken(drafted));
      }
      expect(await decide(db, initiativeId, APPROVER, "ws-reassessment", { decision: "approved" }))
        .toMatchObject({ after: "approved" });
      const [beforeResume] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, deployment.id));
      expect(beforeResume.status).toBe("paused");
      await expect(resumeDeployment(db, APPROVER, "ws-reassessment", initiativeId, "Ready.")).rejects.toThrow(ForbiddenError);
      await expect(resumeDeployment(db, RAY_CHEN, "ws-reassessment", initiativeId, " ")).rejects.toThrow(ValidationError);
      await expect(resumeDeployment(db, RAY_CHEN, "other-workspace", initiativeId, "Ready.")).rejects.toThrow(NotFoundError);

      const reason = "Approved reassessment reviewed; restore the paused release.";
      expect(await resumeDeployment(db, RAY_CHEN, "ws-reassessment", initiativeId, reason))
        .toMatchObject({ deploymentId: deployment.id, before: "approved", after: "deployed" });
      const [resumed] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, deployment.id));
      expect(resumed).toMatchObject({ status: "deployed", pausedAt: null });
      const [incident] = await db.select().from(incidents).where(eq(incidents.id, breach.incidentId));
      expect(incident.resolvedAt).toBeNull();
      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const recoveryEvents = events.filter((event) => event.action === "deploy" && event.metadata?.reviewCycleId === reviewCycleId);
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0]).toMatchObject({
        actor: RAY_CHEN.id, actorRole: "admin", before: "approved", after: "deployed",
        metadata: { deploymentId: deployment.id, reviewCycleId, reason },
      });
      await expect(resumeDeployment(db, RAY_CHEN, "ws-reassessment", initiativeId, reason)).rejects.toThrow(IllegalTransitionError);
    });

    it.each(["initial", "open", "missing-decision", "wrong-decision", "newer-cycle", "deployed", "candidate-only"])(
      "does not resume an approved initiative with %s recovery context",
      async (scenario) => {
        const initiativeId = await memberChatCopilotId(db);
        const [priorCycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, initiativeId));
        const cycleId = `cycle-${randomUUID()}`;
        const openedAt = new Date(PLUS_14D);
        await db.insert(reviewCycles).values({
          ...priorCycle, id: cycleId, kind: scenario === "initial" ? "initial" : "reassessment",
          openedAt, closedAt: scenario === "open" ? null : new Date(PLUS_14D + 1000),
        });
        if (scenario !== "missing-decision") await db.insert(initiativeDecisions).values({
          id: `decision-${randomUUID()}`, initiativeId, cycleId,
          type: scenario === "wrong-decision" ? "rejected" : "approved",
          approver: APPROVER.id, decidedAt: new Date(PLUS_14D + 1000),
        });
        if (scenario === "newer-cycle") await db.insert(reviewCycles).values({
          ...priorCycle, id: `cycle-${randomUUID()}`, kind: "reassessment", openedAt: new Date(PLUS_14D + 2000), closedAt: null,
        });
        await db.update(initiatives).set({ state: "approved" }).where(eq(initiatives.id, initiativeId));
        await db.update(deploymentVersions).set({
          status: scenario === "candidate-only" ? "awaiting_promotion_signoff" : scenario === "deployed" ? "deployed" : "paused",
        }).where(eq(deploymentVersions.initiativeId, initiativeId));
        const beforeVersions = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
        const beforeEvents = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
        await expect(resumeDeployment(db, RAY_CHEN, null, initiativeId, "Attempt recovery.")).rejects.toThrow();
        expect(await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId))).toEqual(beforeVersions);
        expect(await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId))).toEqual(beforeEvents);
      },
    );

    it("pauseDeployment checks workspace before lifecycle state and allows the owning workspace", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await db
        .update(initiatives)
        .set({ workspaceId: "ws-A", state: "paused" })
        .where(eq(initiatives.id, initiativeId));

      await expect(
        pauseDeployment(db, RAY_CHEN, "ws-B", initiativeId, "foreign attempt"),
      ).rejects.toThrow(NotFoundError);

      await db
        .update(initiatives)
        .set({ state: "deployed" })
        .where(eq(initiatives.id, initiativeId));
      await expect(
        pauseDeployment(db, RAY_CHEN, "ws-A", initiativeId, "owner pause"),
      ).resolves.toMatchObject({ after: "paused" });
    });

    it("resumeDeployment checks workspace before lifecycle state and allows null-workspace rows", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await db
        .update(initiatives)
        .set({ workspaceId: "ws-A" })
        .where(eq(initiatives.id, initiativeId));

      await expect(
        resumeDeployment(db, RAY_CHEN, "ws-B", initiativeId, "foreign attempt"),
      ).rejects.toThrow(NotFoundError);

      await db
        .update(initiatives)
        .set({ workspaceId: null, state: "paused" })
        .where(eq(initiatives.id, initiativeId));
      await db
        .update(deploymentVersions)
        .set({ status: "paused" })
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      await expect(
        resumeDeployment(db, RAY_CHEN, "ws-any", initiativeId, "shared resume"),
      ).resolves.toMatchObject({ after: "deployed" });
    });
  });

  /* -----------------------------------------------------------------------
   * P2-5b fix — external-review finding: pauseDeployment/resumeDeployment
   * flipped `initiatives.state` (and `deployment_versions.status`) with a
   * plain `where(eq(id))` update, no observed-state predicate — a
   * concurrent change (e.g. the breach monitor pausing the same deployment)
   * would be silently clobbered. Both updates are now compare-and-set (CAS),
   * mirroring promotion-service.test.ts's "promoteCheckpoint — concurrency"
   * tests: true overlapping transactions aren't reproducible against PGlite,
   * so these tests simulate the race deterministically by injecting a
   * same-transaction write (via `tx`) between the service's own read and its
   * CAS update — this reproduces the exact DB-visible effect a genuinely
   * concurrent committed write would have (the predicate no longer matches).
   * -------------------------------------------------------------------- */
  describe("pauseDeployment / resumeDeployment — concurrency (compare-and-set)", () => {
    it("pauseDeployment: a concurrent write that changes the initiative's state before the CAS update throws ConflictError, and the whole transaction rolls back (no partial write)", async () => {
      const initiativeId = await memberChatCopilotId(db);

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
                if (values.state === "paused") {
                  const realWhere = base.where.bind(base);
                  base.where = (cond: unknown) => {
                    const afterWhere = realWhere(cond);
                    const realReturning = afterWhere.returning.bind(afterWhere);
                    afterWhere.returning = async (...args: unknown[]) => {
                      // Simulated concurrent writer: flips the initiative's
                      // state directly, inside the SAME transaction, between
                      // pauseDeployment's own read (captured as
                      // `initiative.state`) and its CAS update below.
                      await realUpdate(initiatives)
                        .set({ state: "retired" })
                        .where(eq(initiatives.id, initiativeId));
                      return realReturning(...args);
                    };
                    return afterWhere;
                  };
                }
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
        await pauseDeployment(db, RAY_CHEN, null, initiativeId, "Manual pause for maintenance.");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write and any
      // audit event that would otherwise have followed the CAS update.
      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("deployed");
      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(dep!.status).toBe("deployed");
      expect(dep!.pausedAt).toBeNull();
      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      expect(events.find((e) => e.action === "pause")).toBeUndefined();
    });

    it("resumeDeployment: a concurrent write that changes the initiative's state before the CAS update throws ConflictError, and the whole transaction rolls back (no partial write)", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await pauseDeployment(db, RAY_CHEN, null, initiativeId, "Manual pause for maintenance.");

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
                if (values.state === "deployed") {
                  const realWhere = base.where.bind(base);
                  base.where = (cond: unknown) => {
                    const afterWhere = realWhere(cond);
                    const realReturning = afterWhere.returning.bind(afterWhere);
                    afterWhere.returning = async (...args: unknown[]) => {
                      // Simulated concurrent writer: flips the initiative's
                      // state directly, inside the SAME transaction, between
                      // resumeDeployment's own read (captured as
                      // `initiative.state`) and its CAS update below.
                      await realUpdate(initiatives)
                        .set({ state: "retired" })
                        .where(eq(initiatives.id, initiativeId));
                      return realReturning(...args);
                    };
                    return afterWhere;
                  };
                }
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
        await resumeDeployment(db, RAY_CHEN, null, initiativeId, "Maintenance complete.");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // Whole transaction rolled back — the deployment stays paused (the
      // state going into this call), not silently flipped to deployed.
      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("paused");
      const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(dep!.status).toBe("paused");
    });
  });

  describe("admin cannot approve/sign (separation of duties, pinned from the admin surface)", () => {
    it("an admin actor attempting decide() via initiative-service is rejected with IllegalTransitionError", async () => {
      // Any in_review initiative works; #7 provider-dedup-agent is mid-review at seed time.
      const [provider] = await db
        .select()
        .from(initiatives)
        .where(eq(initiatives.slug, "provider-dedup-agent"));
      expect(provider!.state).toBe("in_review");

      await expect(
        decide(db, provider!.id, RAY_CHEN, null, { decision: "approved" }),
      ).rejects.toThrow(IllegalTransitionError);
    });

    it("admin-service exposes no sign/decide method — only threshold + pause/resume", async () => {
      const adminService = await import("./admin-service");
      expect((adminService as Record<string, unknown>).decide).toBeUndefined();
      expect((adminService as Record<string, unknown>).signReview).toBeUndefined();
      expect(typeof adminService.setEvalThreshold).toBe("function");
      expect(typeof adminService.pauseDeployment).toBe("function");
      expect(typeof adminService.resumeDeployment).toBe("function");
    });

    it("approver role is unaffected — a real approver can still decide() normally (control case)", async () => {
      const [provider] = await db
        .select()
        .from(initiatives)
        .where(eq(initiatives.slug, "provider-dedup-agent"));
      // provider-dedup-agent is 3-of-5 signed at seed time, so an `approved`
      // would (correctly) hit the M2.5 completeness gate — this test isolates
      // the transition-level ROLE authority instead, using `rejected` (which
      // has no completeness precondition): the approver passes the authority
      // check while the admin one above is rejected.
      const result = await decide(db, provider!.id, APPROVER, null, { decision: "rejected" });
      expect(result.type).toBe("rejected");
    });
  });

  /* -----------------------------------------------------------------------
   * P1 fix — independent security review: `setEvalThreshold`, `pauseDeployment`,
   * and `resumeDeployment` were the only three mutation services in the
   * codebase that never received the session workspace and never called
   * workspaceMismatch/assertWorkspaceAccess (unlike triage/submitIntake/
   * decide/signReview/returnReview in initiative-service.ts,
   * promoteCheckpoint/rollbackDeployment in promotion-service.ts, and all
   * four exception ops). Any authenticated demo session that learned a
   * live-created initiative id in a DIFFERENT workspace could pause/resume
   * its deployment, or rewrite its threshold override, writing an audit
   * event against an initiative it does not own. Mirrors
   * promotion-service.test.ts's "workspace authorization" blocks — same
   * helper shape, same NotFoundError-on-mismatch semantics (never leaks
   * that the initiative exists in a different workspace).
   * -------------------------------------------------------------------- */
  describe("workspace authorization (P1 fix)", () => {
    /** A fresh initiative + one deployment_versions row (+ a Q-01
     * effectiveControls row so setEvalThreshold's project-override branch
     * has something to update), tagged with `workspaceId`. The initiative's
     * lifecycle state and the deployment's status are force-set directly
     * (bypassing the full submitIntake/triage/decide flow — these tests
     * only need a deployed-or-paused initiative/deployment pair to exercise
     * pause/resume/threshold, not a fully-adjudicated one), same pattern as
     * promotion-service.test.ts's `initiativeWithDeploymentsInWorkspace`. */
    async function initiativeWithDeploymentInWorkspace(
      workspaceId: string | null,
      initiativeState: "deployed" | "paused" | "re_review" = "deployed",
      deploymentStatus: "deployed" | "paused" = "deployed",
    ): Promise<{ initiativeId: string; deploymentId: string }> {
      const draft = await createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: REQUESTER,
        requesterName: "Priya Raman",
        workspaceId,
      });
      await db.update(initiatives).set({ state: initiativeState }).where(eq(initiatives.id, draft.initiativeId));

      const deploymentId = `dep-${randomUUID()}`;
      await db.insert(deploymentVersions).values({
        id: deploymentId,
        initiativeId: draft.initiativeId,
        version: "v1.0",
        status: deploymentStatus,
        modelVersion: null,
        selfHosted: false,
        feedbackProvenanceSignedOff: false,
        deployedAt: new Date(Date.now() - 100_000),
        pausedAt: deploymentStatus === "paused" ? new Date() : null,
        retiredAt: null,
      });
      await db.insert(effectiveControls).values({
        id: `ec-${randomUUID()}`,
        deploymentId,
        controlId: "Q-01",
        version: 1,
        status: "met",
        evidence: "test fixture",
        evidenceAt: new Date(),
        createdAt: new Date(),
      });
      return { initiativeId: draft.initiativeId, deploymentId };
    }

    describe("setEvalThreshold — project override", () => {
      it("a mismatched workspace session gets NotFoundError (same shape as unknown id)", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A");
        await expect(
          setEvalThreshold(db, RAY_CHEN, "ws-B", { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "r" }),
        ).rejects.toThrow(NotFoundError);
        await expect(
          setEvalThreshold(db, RAY_CHEN, "ws-B", { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "r" }),
        ).rejects.toThrow(`initiative not found: ${initiativeId}`);
      });

      it("the owning workspace session succeeds", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A");
        const result = await setEvalThreshold(db, RAY_CHEN, "ws-A", {
          controlId: "Q-01",
          initiativeId,
          newValue: 0.06,
          reason: "r",
        });
        expect(result.after).toBe(0.06);
      });

      it("a null-workspace session cannot change a workspace-tagged initiative's override", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A");
        await expect(
          setEvalThreshold(db, RAY_CHEN, null, { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "r" }),
        ).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) initiative's override is changeable from ANY session workspace", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace(null);
        const result = await setEvalThreshold(db, RAY_CHEN, "ws-anything-at-all", {
          controlId: "Q-01",
          initiativeId,
          newValue: 0.06,
          reason: "r",
        });
        expect(result.after).toBe(0.06);
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const { initiativeId, deploymentId } = await initiativeWithDeploymentInWorkspace("ws-A");
        await expect(
          setEvalThreshold(db, RAY_CHEN, "ws-B", { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "r" }),
        ).rejects.toThrow(NotFoundError);

        const ecRows = await db
          .select()
          .from(effectiveControls)
          .where(eq(effectiveControls.deploymentId, deploymentId));
        const q01 = ecRows.find((e) => e.controlId === "Q-01");
        expect(q01!.thresholdOverride).toBeNull(); // unchanged
        const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
        expect(events.find((e) => e.action === "control_threshold_changed")).toBeUndefined();
      });
    });

    describe("pauseDeployment", () => {
      it("a mismatched workspace session gets NotFoundError (same shape as unknown id)", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "deployed", "deployed");
        await expect(pauseDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(NotFoundError);
        await expect(pauseDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(
          `initiative not found: ${initiativeId}`,
        );
      });

      it("the owning workspace session succeeds", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "deployed", "deployed");
        const result = await pauseDeployment(db, RAY_CHEN, "ws-A", initiativeId, "reason");
        expect(result.after).toBe("paused");
      });

      it("a null-workspace session cannot pause a workspace-tagged initiative's deployment", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "deployed", "deployed");
        await expect(pauseDeployment(db, RAY_CHEN, null, initiativeId, "reason")).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) initiative's deployment is pausable from ANY session workspace", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace(null, "deployed", "deployed");
        const result = await pauseDeployment(db, RAY_CHEN, "ws-anything-at-all", initiativeId, "reason");
        expect(result.after).toBe("paused");
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const { initiativeId, deploymentId } = await initiativeWithDeploymentInWorkspace(
          "ws-A",
          "deployed",
          "deployed",
        );
        await expect(pauseDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(NotFoundError);

        const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
        expect(init!.state).toBe("deployed"); // unchanged
        const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, deploymentId));
        expect(dep!.status).toBe("deployed"); // unchanged
        const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
        expect(events.find((e) => e.action === "pause")).toBeUndefined();
      });
    });

    describe("resumeDeployment", () => {
      it("a mismatched workspace session gets NotFoundError (same shape as unknown id)", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "paused", "paused");
        await expect(resumeDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(NotFoundError);
        await expect(resumeDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(
          `initiative not found: ${initiativeId}`,
        );
      });

      it("the owning workspace session succeeds", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "paused", "paused");
        const result = await resumeDeployment(db, RAY_CHEN, "ws-A", initiativeId, "reason");
        expect(result.after).toBe("deployed");
      });

      it("a null-workspace session cannot resume a workspace-tagged initiative's deployment", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace("ws-A", "paused", "paused");
        await expect(resumeDeployment(db, RAY_CHEN, null, initiativeId, "reason")).rejects.toThrow(NotFoundError);
      });

      it("a seeded (null-workspace) initiative's deployment is resumable from ANY session workspace", async () => {
        const { initiativeId } = await initiativeWithDeploymentInWorkspace(null, "paused", "paused");
        const result = await resumeDeployment(db, RAY_CHEN, "ws-anything-at-all", initiativeId, "reason");
        expect(result.after).toBe("deployed");
      });

      it("no partial write happens on a workspace-mismatch rejection", async () => {
        const { initiativeId, deploymentId } = await initiativeWithDeploymentInWorkspace(
          "ws-A",
          "paused",
          "paused",
        );
        await expect(resumeDeployment(db, RAY_CHEN, "ws-B", initiativeId, "reason")).rejects.toThrow(NotFoundError);

        const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
        expect(init!.state).toBe("paused"); // unchanged
        const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, deploymentId));
        expect(dep!.status).toBe("paused"); // unchanged
        const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
        expect(events.find((e) => e.action === "resume")).toBeUndefined();
      });
    });
  });
});
