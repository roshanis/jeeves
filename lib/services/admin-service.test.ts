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
import { auditEvents, controlDefinitions, deploymentVersions, effectiveControls, initiatives } from "../db/schema";
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
import { IllegalTransitionError, decide, createDraft } from "./initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";

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
