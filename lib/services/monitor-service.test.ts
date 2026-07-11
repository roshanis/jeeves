/**
 * Tests for lib/services/monitor-service.ts (task brief deliverable 1 + 4).
 * Uses the real seed dataset (scripts/seed.ts#seedDatabase) so the breach
 * scenario exercises the actual #4 member-chat-copilot series described in
 * seed-spec §4 (days 11-13 sustained breach within base+14d).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase, BASE_DATE_MS } from "../../scripts/seed";
import {
  auditEvents,
  deploymentVersions,
  effectiveControls,
  incidents,
  initiatives,
  reviewCycles,
} from "../db/schema";
import { runMonitor, listIncidents } from "./monitor-service";
import { SYSTEM_ACTOR } from "./actors";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLUS_14D = BASE_DATE_MS + 14 * DAY_MS;
const PLUS_8D = BASE_DATE_MS + 8 * DAY_MS;

const RAY_CHEN = { id: "ray-chen", role: "admin" as const };

async function memberChatCopilot(db: TestDb) {
  const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
  const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, init!.id));
  return { init: init!, dep: dep! };
}

describe("lib/services/monitor-service", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  describe("runMonitor — breach detection + idempotency (plan.md §2 step 5)", () => {
    it("does not breach #4 member-chat-copilot at nowTs=base+8d (before the sustained window)", async () => {
      const result = await runMonitor(db, SYSTEM_ACTOR, PLUS_8D);
      const chatCopilotBreach = result.breaches.find((b) => b.deploymentId);
      const { dep } = await memberChatCopilot(db);
      const breachForDep = result.breaches.find((b) => b.deploymentId === dep.id);
      expect(breachForDep).toBeUndefined();
      expect(result.incidentsCreated).toBe(0);

      const { init } = await memberChatCopilot(db);
      expect(init.state).toBe("deployed");
      void chatCopilotBreach;
    });

    it("breaches #4 member-chat-copilot at nowTs=base+14d: incident created, deployment+initiative paused, reassessment cycle opened, audit chain written", async () => {
      const { init: initBefore, dep: depBefore } = await memberChatCopilot(db);
      expect(initBefore.state).toBe("deployed");
      expect(depBefore.status).toBe("deployed");

      const result = await runMonitor(db, RAY_CHEN, PLUS_14D);

      const { init: initAfter, dep: depAfter } = await memberChatCopilot(db);
      expect(initAfter.state).toBe("re_review");
      expect(depAfter.status).toBe("paused");
      expect(depAfter.pausedAt).not.toBeNull();

      const breach = result.breaches.find((b) => b.deploymentId === depAfter.id);
      expect(breach).toBeTruthy();
      expect(breach!.isNew).toBe(true);
      expect(breach!.controlId).toBe("Q-01");
      expect(breach!.threshold).toBe(0.08);
      expect(breach!.breachingValues.every((v) => v > 0.08)).toBe(true);
      expect(result.incidentsCreated).toBe(1);
      expect(result.alreadyKnown).toBe(0);
      expect(result.evaluated).toBeGreaterThan(0);

      // Incident row.
      const incidentRows = await db.select().from(incidents).where(eq(incidents.deploymentId, depAfter.id));
      expect(incidentRows).toHaveLength(1);
      expect(incidentRows[0]!.identityKey).toBe(breach!.identityKey);
      expect(incidentRows[0]!.reviewCycleId).toBeTruthy();

      // Reassessment review cycle.
      const cycles = await db
        .select()
        .from(reviewCycles)
        .where(eq(reviewCycles.initiativeId, initAfter.id));
      const reassessment = cycles.find((c) => c.kind === "reassessment");
      expect(reassessment).toBeTruthy();
      expect(reassessment!.incidentId).toBe(incidentRows[0]!.id);

      // Effective control flipped to breached.
      const ecRows = await db
        .select()
        .from(effectiveControls)
        .where(eq(effectiveControls.deploymentId, depAfter.id));
      const q01 = ecRows.filter((e) => e.controlId === "Q-01").sort((a, b) => b.version - a.version)[0];
      expect(q01!.status).toBe("breached");

      // Audit chain: pause + reassessment + incident_recorded events all present.
      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initAfter.id));
      const pauseEvent = events.find((e) => e.action === "pause");
      const reassessEvent = events.find((e) => e.action === "open_reassessment");
      const incidentEvent = events.find((e) => e.action === "incident_recorded");
      expect(pauseEvent).toBeTruthy();
      expect(pauseEvent!.detail).toBeTruthy();
      expect(pauseEvent!.actorRole).toBe("system");
      expect(reassessEvent).toBeTruthy();
      expect(reassessEvent!.actorRole).toBe("system");
      expect(incidentEvent).toBeTruthy();
      expect(incidentEvent!.detail.length).toBeGreaterThan(0);
    });

    it("a second runMonitor call at the same nowTs creates zero new incidents/transitions (idempotent re-run)", async () => {
      const first = await runMonitor(db, RAY_CHEN, PLUS_14D);
      expect(first.incidentsCreated).toBe(1);

      const { dep: depAfterFirst } = await memberChatCopilot(db);
      const incidentsAfterFirst = await db.select().from(incidents);
      const auditEventsAfterFirst = await db.select().from(auditEvents);

      const second = await runMonitor(db, RAY_CHEN, PLUS_14D);
      expect(second.incidentsCreated).toBe(0);

      const { dep: depAfterSecond, init: initAfterSecond } = await memberChatCopilot(db);
      expect(depAfterSecond.status).toBe("paused");
      expect(depAfterSecond.pausedAt?.getTime()).toBe(depAfterFirst.pausedAt?.getTime());
      expect(initAfterSecond.state).toBe("re_review");

      const incidentsAfterSecond = await db.select().from(incidents);
      const auditEventsAfterSecond = await db.select().from(auditEvents);
      expect(incidentsAfterSecond).toHaveLength(incidentsAfterFirst.length);
      expect(auditEventsAfterSecond).toHaveLength(auditEventsAfterFirst.length);

      // The deployment is now `paused` (not `deployed`), so the second run's
      // candidate scan naturally excludes it — a second, independent
      // idempotency guarantee on top of the identityKey check inside
      // runMonitor itself (which a still-`deployed` breach would also hit,
      // see the "second call on a still-deployed breach" case below).
      expect(second.breaches.find((b) => b.deploymentId === depAfterSecond.id)).toBeUndefined();
    });

    it("re-running against a breach whose deployment is still 'deployed' (identityKey check, not just the status filter) creates zero new incidents", async () => {
      // Directly exercises the identityKey upsert-guard path rather than
      // relying on the deployment-status filter: flip the deployment back to
      // 'deployed' after the first run's pause, then run again at the same
      // nowTs — the SAME breach window/identityKey must still resolve to
      // "already known", not a second incident.
      const first = await runMonitor(db, RAY_CHEN, PLUS_14D);
      expect(first.incidentsCreated).toBe(1);
      const { dep } = await memberChatCopilot(db);
      await db.update(deploymentVersions).set({ status: "deployed" }).where(eq(deploymentVersions.id, dep.id));

      const incidentsBefore = await db.select().from(incidents);
      const second = await runMonitor(db, RAY_CHEN, PLUS_14D);
      const incidentsAfter = await db.select().from(incidents);

      expect(second.incidentsCreated).toBe(0);
      expect(second.alreadyKnown).toBe(1);
      expect(incidentsAfter).toHaveLength(incidentsBefore.length);
      const breach = second.breaches.find((b) => b.deploymentId === dep.id);
      expect(breach).toBeTruthy();
      expect(breach!.isNew).toBe(false);
    });

    it("skips deployments without a Q-01 effective control (e.g. #10 fwa-anomaly-detector, pre-LLM, no eval series)", async () => {
      const [fwa] = await db
        .select()
        .from(initiatives)
        .where(eq(initiatives.slug, "fwa-anomaly-detector"));
      const result = await runMonitor(db, SYSTEM_ACTOR, PLUS_14D);
      const [fwaDep] = fwa
        ? await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, fwa.id))
        : [];
      if (fwaDep) {
        expect(result.breaches.find((b) => b.deploymentId === fwaDep.id)).toBeUndefined();
      }
    });
  });

  describe("listIncidents — public read-only", () => {
    it("returns incidents sorted most-recent-first after a breach", async () => {
      await runMonitor(db, RAY_CHEN, PLUS_14D);
      const rows = await listIncidents(db);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.controlId).toBe("Q-01");
    });

    it("returns an empty list before any breach has been detected", async () => {
      const rows = await listIncidents(db);
      expect(rows).toEqual([]);
    });
  });
});
