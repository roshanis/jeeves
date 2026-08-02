/**
 * Tests for lib/services/monitor-service.ts (task brief deliverable 1 + 4).
 * Uses the real seed dataset (scripts/seed.ts#seedDatabase) so the breach
 * scenario exercises the actual #4 member-chat-copilot series described in
 * seed-spec §4 (days 11-13 sustained breach within base+14d).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase, BASE_DATE_MS } from "../../scripts/seed";
import {
  auditEvents,
  deploymentVersions,
  effectiveControls,
  incidents,
  initiatives,
  observations,
  reviewCycles,
} from "../db/schema";
import { runMonitor, listIncidents } from "./monitor-service";
import { SYSTEM_ACTOR } from "./actors";
import { createDraft } from "./initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLUS_14D = BASE_DATE_MS + 14 * DAY_MS;
const PLUS_8D = BASE_DATE_MS + 8 * DAY_MS;

const RAY_CHEN = { id: "ray-chen", role: "admin" as const };

async function memberChatCopilot(db: TestDb) {
  const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
  const [dep] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, init!.id));
  return { init: init!, dep: dep! };
}

// #10 fwa-anomaly-detector: deployed, no Q-01 effective control / no
// eval_hallucination series at seed time (seed-spec §4 — it has a
// flatCostSeries only), so it's a clean host for a synthetic Q-01
// breach fixture that won't collide with any pre-existing observations.
async function fwaAnomalyDetector(db: TestDb) {
  const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "fwa-anomaly-detector"));
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

  /* -----------------------------------------------------------------------
   * P2-5b fix — external-review finding: the breach-pause flip
   * (`initiatives.state` -> 'paused') carried no observed-state predicate —
   * a concurrent change (e.g. an admin manually acting on the same
   * initiative between the candidate scan and this transaction) would be
   * silently clobbered. Now compare-and-set, mirroring
   * promotion-service.test.ts's "promoteCheckpoint — concurrency" tests:
   * true overlapping transactions aren't reproducible against PGlite, so
   * this simulates the race deterministically by injecting a
   * same-transaction write between the read and the CAS update.
   *
   * P2-7 fix — external-review finding: previously a single candidate's
   * failure (this CAS conflict, an illegal-state pause attempt, or the FK
   * hazard below) aborted the ENTIRE `runMonitor` call, for every
   * deployment. Now isolated per-candidate: recorded in `result.errors`,
   * the run completes, and other candidates are unaffected.
   * -------------------------------------------------------------------- */
  describe("runMonitor — per-candidate error isolation (external-review P2-5b/P2-7)", () => {
    it("a concurrent write that changes the initiative's state before the breach-pause CAS update is recorded in result.errors and does not abort the run (no partial write for that candidate)", async () => {
      const { init, dep } = await memberChatCopilot(db);

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      let txCallCount = 0;
      const spy = vi.spyOn(dbAny, "transaction").mockImplementation((cb: any) => {
        txCallCount += 1;
        // Call #1 is runMonitor's own candidate scan (loadDeployedCandidates);
        // call #2 is the breaching candidate's own transaction — inject there.
        if (txCallCount !== 2) return realTransaction(cb);
        return realTransaction(async (tx: any) => {
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
                      // runMonitor's own read (`initiative.state`, captured
                      // during the candidate scan) and its CAS update below.
                      await realUpdate(initiatives).set({ state: "retired" }).where(eq(initiatives.id, init.id));
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
        });
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const result = await runMonitor(db, SYSTEM_ACTOR, PLUS_14D);
      spy.mockRestore();

      // The run completed (did not throw) despite the CAS conflict.
      expect(result.incidentsCreated).toBe(0);
      const err = result.errors.find((e) => e.deploymentId === dep.id);
      expect(err).toBeTruthy();
      expect(err!.message).toContain("changed concurrently");

      // P1 fix (external-review): the breach WAS detected — it must not
      // vanish from `breaches` just because persistence failed. It's
      // represented with `failed: true` and excluded from
      // `incidentsCreated` above.
      const failedBreach = result.breaches.find((b) => b.deploymentId === dep.id);
      expect(failedBreach).toBeTruthy();
      expect(failedBreach!.failed).toBe(true);
      expect(failedBreach!.isNew).toBe(false);
      expect(failedBreach!.incidentId).toBe("");

      // Whole per-candidate transaction rolled back — including the
      // injected write — so the initiative/deployment are exactly as they
      // were before this run, and no incident/reassessment was created.
      const [initAfter] = await db.select().from(initiatives).where(eq(initiatives.id, init.id));
      expect(initAfter!.state).toBe("deployed");
      const [depAfter] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, dep.id));
      expect(depAfter!.status).toBe("deployed");
      const incidentRows = await db.select().from(incidents).where(eq(incidents.deploymentId, dep.id));
      expect(incidentRows).toHaveLength(0);
    });

    it("a breaching candidate whose initiative.state does not permit 'system' to pause is skipped (recorded in result.errors) while a genuinely breaching candidate still gets its incident", async () => {
      const { init: chatInit, dep: chatDep } = await memberChatCopilot(db);
      expect(chatInit.id).toBeTruthy();
      const { init: fwaInit, dep: fwaDep } = await fwaAnomalyDetector(db);
      expect(fwaInit.tier).toBeTruthy();

      // Attach a synthetic Q-01 effective control + a sustained-breach
      // eval_hallucination series (3 consecutive points far above every
      // tier's threshold) to the second candidate.
      await db.insert(effectiveControls).values({
        id: `ec-test-${fwaDep.id}`,
        deploymentId: fwaDep.id,
        controlId: "Q-01",
        version: 1,
        status: "met",
        evidence: "test fixture — synthetic breach series",
        evidenceAt: new Date(BASE_DATE_MS),
        createdAt: new Date(BASE_DATE_MS),
      });
      for (const d of [11, 12, 13]) {
        await db.insert(observations).values({
          id: `obs-test-${fwaDep.id}-${d}`,
          deploymentId: fwaDep.id,
          kind: "eval_hallucination",
          ts: new Date(BASE_DATE_MS + d * DAY_MS),
          value: 0.99,
        });
      }

      // Data-drift scenario (the point of this test): the deployment row is
      // still 'deployed' (so it remains a monitor candidate), but the
      // OWNING initiative's lifecycle state has drifted to one that does not
      // permit 'system' to 'pause' (lib/lifecycle/transitions.ts: 'pause' is
      // only legal from 'deployed').
      await db.update(initiatives).set({ state: "in_review" }).where(eq(initiatives.id, fwaInit.id));

      const result = await runMonitor(db, SYSTEM_ACTOR, PLUS_14D);

      // The genuinely breaching candidate still gets its incident.
      const chatBreach = result.breaches.find((b) => b.deploymentId === chatDep.id);
      expect(chatBreach).toBeTruthy();
      expect(chatBreach!.isNew).toBe(true);
      expect(result.incidentsCreated).toBe(1);

      // The pause-illegal candidate is skipped, not thrown/aborted.
      const skip = result.errors.find((e) => e.deploymentId === fwaDep.id);
      expect(skip).toBeTruthy();
      expect(skip!.message).toContain("in_review");
      expect(skip!.message).toContain("pause");

      // P1 fix (external-review): still a DETECTED breach — represented in
      // `breaches` with `failed: true`, just never persisted/counted.
      const failedBreach = result.breaches.find((b) => b.deploymentId === fwaDep.id);
      expect(failedBreach).toBeTruthy();
      expect(failedBreach!.failed).toBe(true);
      expect(failedBreach!.isNew).toBe(false);

      // No incident/pause/reassessment for the skipped candidate.
      const fwaIncidents = await db.select().from(incidents).where(eq(incidents.deploymentId, fwaDep.id));
      expect(fwaIncidents).toHaveLength(0);
      const [fwaInitAfter] = await db.select().from(initiatives).where(eq(initiatives.id, fwaInit.id));
      expect(fwaInitAfter!.state).toBe("in_review");
      const [fwaDepAfter] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, fwaDep.id));
      expect(fwaDepAfter!.status).toBe("deployed");
    });

    it("a deployed initiative with no risk assessment on file records a descriptive error (logged via console.error) instead of inserting an empty-string FK, while a genuinely-breaching healthy candidate (#4 member-chat-copilot) still gets its incident — P1 fix: the failed candidate stays visible in `breaches` (failed marker) and out of `incidentsCreated`", async () => {
      // Seeded initiatives all carry a risk assessment from their normal
      // triage() history, and it's FK-referenced by their initial
      // review_cycles row (can't just delete it out from under them). To get
      // a deployed initiative with GENUINELY no risk assessment on file,
      // build one directly: createDraft() never creates a risk assessment
      // (only triage() does, per initiative-service.ts) — flip it straight
      // to 'deployed' without ever calling triage(), and attach a synthetic
      // Q-01 breach fixture, exactly like the pause-illegal-state test above.
      const { dep: chatDep } = await memberChatCopilot(db);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const draft = await createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: { id: "priya-raman", role: "requester" },
        requesterName: "Priya Raman",
      });
      await db
        .update(initiatives)
        .set({ state: "deployed", tier: "high" })
        .where(eq(initiatives.id, draft.initiativeId));
      const depId = `dep-test-${draft.initiativeId}`;
      await db.insert(deploymentVersions).values({
        id: depId,
        initiativeId: draft.initiativeId,
        version: "v1.0",
        status: "deployed",
        modelVersion: null,
        selfHosted: false,
        deployedAt: new Date(BASE_DATE_MS),
      });
      await db.insert(effectiveControls).values({
        id: `ec-test-${depId}`,
        deploymentId: depId,
        controlId: "Q-01",
        version: 1,
        status: "met",
        evidence: "test fixture — synthetic breach series",
        evidenceAt: new Date(BASE_DATE_MS),
        createdAt: new Date(BASE_DATE_MS),
      });
      for (const d of [11, 12, 13]) {
        await db.insert(observations).values({
          id: `obs-test-${depId}-${d}`,
          deploymentId: depId,
          kind: "eval_hallucination",
          ts: new Date(BASE_DATE_MS + d * DAY_MS),
          value: 0.99,
        });
      }

      const result = await runMonitor(db, SYSTEM_ACTOR, PLUS_14D);

      // The genuinely-breaching healthy candidate (#4 member-chat-copilot)
      // still gets its incident, unaffected by the other candidate's
      // failure.
      const chatBreach = result.breaches.find((b) => b.deploymentId === chatDep.id);
      expect(chatBreach).toBeTruthy();
      expect(chatBreach!.isNew).toBe(true);
      expect(chatBreach!.failed).toBeUndefined();

      // Only the persisted (chat-copilot) breach counts toward
      // incidentsCreated — the failed candidate does not, even though it
      // was genuinely detected.
      expect(result.incidentsCreated).toBe(1);
      expect(result.incidentsCreated).toBe(result.breaches.filter((b) => b.isNew).length);

      const err = result.errors.find((e) => e.deploymentId === depId);
      expect(err).toBeTruthy();
      expect(err!.message).toMatch(/risk assessment/i);

      // P1 fix (external-review): the failed candidate's breach was
      // genuinely DETECTED — it must stay visible in `breaches` (marked
      // `failed: true`), not silently vanish, so a failed persistence pass
      // is never indistinguishable from "nothing breached".
      const failedBreach = result.breaches.find((b) => b.deploymentId === depId);
      expect(failedBreach).toBeTruthy();
      expect(failedBreach!.failed).toBe(true);
      expect(failedBreach!.isNew).toBe(false);
      expect(failedBreach!.incidentId).toBe("");
      expect(failedBreach!.reviewCycleId).toBeNull();

      // The failure leaves a trace in the server logs (part 1 of the P1
      // fix) — a real deployment must never fail silently with no record
      // anywhere other than the additive `errors[]`.
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedFailure = consoleErrorSpy.mock.calls.find((call) =>
        String(call[0]).includes(depId),
      );
      expect(loggedFailure).toBeTruthy();
      expect(String(loggedFailure![0])).toMatch(/risk assessment/i);
      consoleErrorSpy.mockRestore();

      // Whole transaction rolled back — the initiative is never left
      // paused with no reassessment cycle to show for it.
      const [initAfter] = await db.select().from(initiatives).where(eq(initiatives.id, draft.initiativeId));
      expect(initAfter!.state).toBe("deployed");
      const [depAfter] = await db.select().from(deploymentVersions).where(eq(deploymentVersions.id, depId));
      expect(depAfter!.status).toBe("deployed");
      const cycles = await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, draft.initiativeId));
      expect(cycles).toHaveLength(0);
      const incidentRows = await db.select().from(incidents).where(eq(incidents.deploymentId, depId));
      expect(incidentRows).toHaveLength(0);
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
