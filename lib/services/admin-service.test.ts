/**
 * Tests for lib/services/admin-service.ts (task brief deliverable 2 + 4):
 * the two live admin actions (threshold change, pause/resume), both
 * admin-only + reason-required, both writing before/after AuditEvents. Also
 * pins that an admin actor attempting `decide()` (approve/reject) via
 * initiative-service is rejected — separation of duties enforced from the
 * admin surface, not just initiative-service's own test file.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase, BASE_DATE_MS } from "../../scripts/seed";
import { auditEvents, controlDefinitions, deploymentVersions, effectiveControls, initiatives } from "../db/schema";
import {
  setEvalThreshold,
  pauseDeployment,
  resumeDeployment,
  ForbiddenError,
  ValidationError,
} from "./admin-service";
import { runMonitor } from "./monitor-service";
import { IllegalTransitionError, decide } from "./initiative-service";

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

      const result = await setEvalThreshold(db, RAY_CHEN, {
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
      const beforeTighten = await runMonitor(db, RAY_CHEN, BASE_DATE_MS + 8 * DAY_MS);
      const [depBefore] = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(beforeTighten.breaches.find((b) => b.deploymentId === depBefore!.id)).toBeUndefined();

      // Tighten to 0.06 — the ramp (0.045 + 0.0035*day) crosses 0.06 much
      // earlier than 0.08, so the SAME base+8d nowTs now breaches.
      await setEvalThreshold(db, RAY_CHEN, {
        controlId: "Q-01",
        initiativeId,
        newValue: 0.06,
        reason: "Tighten ahead of schedule.",
      });

      const afterTighten = await runMonitor(db, RAY_CHEN, BASE_DATE_MS + 8 * DAY_MS);
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
        setEvalThreshold(db, REQUESTER, {
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
        setEvalThreshold(db, RAY_CHEN, { controlId: "Q-01", initiativeId, newValue: 0.06, reason: "" }),
      ).rejects.toThrow(ValidationError);
    });

    it("tier-default change (initiativeId=null) updates control_definitions.tier_default_thresholds for the named tier", async () => {
      const result = await setEvalThreshold(db, RAY_CHEN, {
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
  });

  describe("pauseDeployment / resumeDeployment", () => {
    it("pauseDeployment requires a non-empty reason (rejects empty string)", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(pauseDeployment(db, RAY_CHEN, initiativeId, "")).rejects.toThrow(ValidationError);
    });

    it("pauseDeployment requires role=admin", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await expect(pauseDeployment(db, REQUESTER, initiativeId, "some reason")).rejects.toThrow(ForbiddenError);
    });

    it("pauseDeployment transitions deployed -> paused with an audit event", async () => {
      const initiativeId = await memberChatCopilotId(db);
      const result = await pauseDeployment(db, RAY_CHEN, initiativeId, "Manual pause for maintenance.");
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
      await pauseDeployment(db, RAY_CHEN, initiativeId, "Manual pause for maintenance.");

      const result = await resumeDeployment(db, RAY_CHEN, initiativeId, "Maintenance complete.");
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
      await pauseDeployment(db, RAY_CHEN, initiativeId, "Manual pause for maintenance.");
      await expect(resumeDeployment(db, RAY_CHEN, initiativeId, "")).rejects.toThrow(ValidationError);
    });

    it("resumeDeployment also restores a re_review (post-breach reassessment) initiative to deployed", async () => {
      const initiativeId = await memberChatCopilotId(db);
      await runMonitor(db, RAY_CHEN, PLUS_14D);
      const [init] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId));
      expect(init!.state).toBe("re_review");

      const result = await resumeDeployment(db, RAY_CHEN, initiativeId, "Reassessment complete, model retrained.");
      expect(result.after).toBe("deployed");
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
        decide(db, provider!.id, RAY_CHEN, { decision: "approved" }),
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
      // provider-dedup-agent is 3-of-5 signed at seed time (not all signed);
      // decide() itself doesn't gate on domain completeness (that's a UI/
      // workflow concern), so this proves the transition-level authority
      // check passes for the correct role while the admin one above rejects.
      const result = await decide(db, provider!.id, APPROVER, { decision: "approved" });
      expect(result.type).toBe("approved");
    });
  });
});
