/**
 * Breach monitor (plan.md §2 step 5, §9 P3; task brief deliverable 1).
 *
 * `runMonitor` is the "Run monitor" admin action: for every deployed
 * initiative that has an eval-quality (`Q-01`) effective control attached to
 * its current deployment, it loads that deployment's `eval_hallucination`
 * observations up to `nowTs`, resolves the effective threshold
 * (project/deployment override > tier default — `resolveThreshold`), and
 * evaluates the sustained-breach rule (`evaluateControl`) — both reused
 * unchanged from `lib/controls/evaluate.ts` per the task brief ("reuse,
 * don't reimplement").
 *
 * On a breach it:
 *   1. Idempotently creates an `incidents` row keyed on the deterministic
 *      `identityKey` (`${deploymentId}:${controlId}:${windowStartTs}`) — a
 *      second `runMonitor` call for the same window inserts nothing new
 *      (checked in-transaction before insert, and the DB's own unique index
 *      on (deployment, control, windowStart) is the backstop).
 *   2. Transitions the deployment + initiative to `paused` via
 *      `lib/lifecycle/transitions.ts#transition()` — actor `system`, reason
 *      derived from the breach detail (transitions.ts requires a non-empty
 *      reason for pause).
 *   3. Opens a reassessment `review_cycles` row via the `open_reassessment`
 *      transition (paused -> re_review), linked back to the incident.
 *   4. Generates a human-readable incident summary. Breach detection stays
 *      deterministic code (agents/ops-monitor/instructions.md: "never you") —
 *      the agent only narrates a detection that already happened. There is
 *      no `AgentPort` method for ops-monitor (see lib/agents/schemas.ts /
 *      mock-adapter.ts's `generateMockIncidentSummary`, which documents that
 *      ops-monitor "has no port method today"), so this module still routes
 *      through `getAgentPort()` to decide mock-vs-real per plan.md §4 (never
 *      call an adapter directly), but for the one ops-monitor shape that
 *      isn't yet a port method, it falls back to the deterministic mock
 *      generator when the port resolved is the mock port — this keeps the
 *      demo fully keyless/offline-safe as the task brief requires ("mock
 *      adapter fine") without inventing a new port method outside this
 *      task's owned files (lib/agents/ports.ts is not owned by this task).
 *   5. Writes an AuditEvent for every transition, all inside one
 *      `db.transaction()` per breached deployment — a partial write (state
 *      changed, no incident row, or vice versa) must never be observable.
 *
 * `nowTs` is a REQUIRED parameter, never read from the wall clock, so a
 * demo/test can replay history deterministically and idempotently.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import {
  auditEvents,
  controlDefinitions,
  deploymentVersions,
  effectiveControls,
  incidents,
  initiatives,
  observations,
  reviewCycles,
  riskAssessments,
} from "../db/schema";
import type { Actor, LifecycleState, Observation, Tier } from "../domain/types";
import { evaluateControl, resolveThreshold, type EffectiveControl } from "../controls/evaluate";
import { transition, IllegalTransitionError, type AuditEventPayload } from "../lifecycle/transitions";
import { getAgentPort } from "../agents";
import { generateMockIncidentSummary } from "../agents/mock-adapter";
import type { GovernanceDomain } from "../agents/ports";
import { SYSTEM_ACTOR } from "./actors";
import { ConflictError } from "./initiative-service";

/**
 * Re-exported so route handlers/callers can catch a compare-and-set race on
 * the automated breach-pause flip (external-review finding P2-5b) the same
 * way `admin-service.ts`'s pauseDeployment/resumeDeployment and
 * `promotion-service.ts`'s promoteCheckpoint already do. Same class, reused
 * (not duplicated).
 */
export { ConflictError };

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

const RUNTIME_CONTROL_ID = "Q-01";

/* -------------------------------------------------------------------------
 * Result shapes
 * ---------------------------------------------------------------------- */

export interface BreachDetail {
  initiativeId: string;
  deploymentId: string;
  controlId: string;
  windowStartTs: number;
  identityKey: string;
  threshold: number;
  breachingValues: number[];
  /** True only when this call actually created the incident/transitions; false when already known. */
  isNew: boolean;
  incidentId: string;
  reviewCycleId: string | null;
}

/**
 * One per-candidate failure recorded instead of aborting the whole run
 * (external-review finding P2-7: "one bad candidate — e.g. a pause-illegal
 * lifecycle state throwing IllegalTransitionError — aborts the entire
 * monitor run for all deployments"). Covers both an explicit pre-flight skip
 * (candidate's `initiative.state` doesn't permit `system` to `pause`) and any
 * error thrown while handling a genuine breach for that candidate (e.g. the
 * CAS conflict in `ConflictError` above, or the FK-hazard guard below).
 */
export interface RunMonitorError {
  initiativeId: string;
  deploymentId: string;
  message: string;
}

export interface RunMonitorResult {
  /** Number of deployed initiatives with a Q-01 effective control that were evaluated. */
  evaluated: number;
  breaches: BreachDetail[];
  incidentsCreated: number;
  alreadyKnown: number;
  /**
   * Per-candidate failures/skips that did NOT abort the run (additive field
   * — existing callers that only read `evaluated`/`breaches`/
   * `incidentsCreated`/`alreadyKnown` are unaffected). Empty when every
   * evaluated candidate completed cleanly.
   */
  errors: RunMonitorError[];
}

/**
 * Pre-flight legality check (external-review finding P2-7b): consults
 * `lib/lifecycle/transitions.ts`'s own transition table — via a real (but
 * discarded) `transition()` call rather than duplicating its declarative
 * rules here — to decide whether `system` may `pause` FROM this initiative's
 * current state, without opening a transaction or throwing. Used to skip a
 * breaching candidate whose `initiative.state` has drifted out of `deployed`
 * (e.g. it was already manually paused/retired/re-reviewed out of band)
 * BEFORE attempting the real pause transition inside that candidate's own
 * transaction.
 */
function isPauseLegalForSystem(state: LifecycleState): boolean {
  try {
    transition(state, "pause", SYSTEM_ACTOR, { ts: 0, reason: "pause-legality probe (not persisted)" });
    return true;
  } catch (err) {
    if (err instanceof IllegalTransitionError) return false;
    throw err;
  }
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function insertAuditEvent(
  tx: Tx,
  initiativeId: string | null,
  payload: AuditEventPayload,
  detail: string,
  metadata?: Record<string, unknown>,
): Promise<unknown> {
  return tx.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(payload.ts),
    actor: payload.actor.id,
    actorRole: payload.actor.role,
    action: payload.action,
    detail,
    before: payload.before,
    after: payload.after,
    metadata: metadata ?? null,
  });
}

/** Deployments currently `deployed` with their owning initiative + tier + flags. */
async function loadDeployedCandidates(tx: Tx): Promise<
  Array<{
    deployment: typeof deploymentVersions.$inferSelect;
    initiative: typeof initiatives.$inferSelect;
    tier: Tier;
  }>
> {
  const deployments = await tx
    .select()
    .from(deploymentVersions)
    .where(eq(deploymentVersions.status, "deployed"));

  const result: Array<{
    deployment: typeof deploymentVersions.$inferSelect;
    initiative: typeof initiatives.$inferSelect;
    tier: Tier;
  }> = [];

  for (const deployment of deployments) {
    const initRows = await tx
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, deployment.initiativeId));
    const initiative = initRows[0];
    if (!initiative || !initiative.tier) continue;
    result.push({ deployment, initiative, tier: initiative.tier as Tier });
  }

  return result;
}

/**
 * Ops-monitor incident narration: agent never decides the breach, only
 * narrates it (agents/ops-monitor/instructions.md). `getAgentPort()` is
 * still called here (per plan.md §4: app code depends only on the port
 * factory, never an adapter directly) purely to select mock-vs-real the
 * same way every other agent call in this codebase does; the actual
 * generation uses `generateMockIncidentSummary` because ops-monitor has no
 * `AgentPort` method yet (see lib/agents/schemas.ts / mock-adapter.ts) —
 * adding one would mean editing lib/agents/ports.ts, which this task does
 * not own. `getAgentPort()` already resolves to the deterministic mock
 * adapter whenever `OPENAI_API_KEY` is unset (tests, demo-safe default),
 * which keeps this fully offline/keyless-safe as the task brief requires.
 */
async function generateIncidentSummary(input: {
  controlId: string;
  initiativeId: string;
  domain: GovernanceDomain;
}): Promise<string> {
  getAgentPort();
  const summary = generateMockIncidentSummary(input);
  return summary.incidentSummaryMd;
}

/* -------------------------------------------------------------------------
 * runMonitor
 * ---------------------------------------------------------------------- */

/**
 * Evaluate every deployed initiative's Q-01 (eval-quality) effective
 * control against its observation series as of `nowTs`, idempotently
 * recording any sustained breach (incident + pause + reassessment).
 */
export async function runMonitor(
  db: Db,
  actor: Actor,
  nowTs: number,
): Promise<RunMonitorResult> {
  const candidates = await db.transaction(async (tx) => loadDeployedCandidates(tx));

  const breaches: BreachDetail[] = [];
  const errors: RunMonitorError[] = [];
  let evaluated = 0;
  let incidentsCreated = 0;
  let alreadyKnown = 0;

  for (const { deployment, initiative, tier } of candidates) {
    // Load Q-01 effective control (may not exist for initiatives without an
    // eval_hallucination series, e.g. seed #10/#5/#6/#12 profiles).
    const ecRows = await db
      .select()
      .from(effectiveControls)
      .where(
        and(
          eq(effectiveControls.deploymentId, deployment.id),
          eq(effectiveControls.controlId, RUNTIME_CONTROL_ID),
        ),
      );
    if (ecRows.length === 0) continue;
    const ec = ecRows.slice().sort((a, b) => b.version - a.version)[0]!;

    const defRows = await db
      .select()
      .from(controlDefinitions)
      .where(eq(controlDefinitions.id, RUNTIME_CONTROL_ID));
    const def = defRows[0];
    if (!def || !def.tierDefaultThresholds || def.sustainedWindow === null) continue;

    evaluated += 1;

    const threshold = resolveThreshold(
      { tierDefaults: def.tierDefaultThresholds as Record<Tier, number> },
      tier,
      ec.thresholdOverride ?? null,
    );

    const obsRows = await db
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.deploymentId, deployment.id),
          eq(observations.kind, def.observationKind ?? "eval_hallucination"),
        ),
      );
    const series: Observation[] = obsRows.map((o) => ({ ts: o.ts.getTime(), value: o.value }));

    const control: EffectiveControl = {
      deploymentId: deployment.id,
      controlId: RUNTIME_CONTROL_ID,
      threshold,
      sustainedWindow: def.sustainedWindow,
    };

    const evalResult = evaluateControl(control, series, nowTs);
    if (!evalResult.breached || !evalResult.identityKey || evalResult.windowStartTs === null) {
      continue;
    }

    // Error isolation (external-review finding P2-7a): one bad candidate
    // must never abort the whole run — everything from the pre-flight
    // legality check through this candidate's transaction is wrapped so any
    // failure (a skipped pre-flight check below, a CAS conflict, a missing
    // risk assessment, or anything else) is recorded against THIS candidate
    // in `errors` and the loop moves on to the next one.
    try {
      // Idempotent per-deployment handling, transactional: check-then-act
      // inside the SAME transaction that would insert, so a breach detected
      // twice in the same run (impossible today — one control per deployment
      // per run — but kept for safety) or across repeated `runMonitor` calls
      // never creates a second incident/transition pair.
      const outcome = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(incidents)
          .where(eq(incidents.identityKey, evalResult.identityKey!));
        if (existing.length > 0) {
          const row = existing[0]!;
          return {
            isNew: false,
            incidentId: row.id,
            reviewCycleId: row.reviewCycleId,
          };
        }

        // Pre-flight legality check (external-review finding P2-7b): only
        // reached for a GENUINELY NEW incident (an idempotent re-run of an
        // already-known breach returns above and never re-attempts the pause
        // transition at all — matching this function's pre-existing
        // idempotency contract). Skip — never even attempt — a breaching
        // candidate whose initiative.state no longer permits `system` to
        // `pause` (e.g. it was already manually paused/retired/opened for
        // re-review out of band since the candidate scan above ran).
        // Nothing has been written yet at this point, so throwing here is
        // equivalent to a clean skip: the transaction rolls back with no
        // side effects, and the per-candidate try/catch below records it in
        // `errors` instead of aborting the whole run.
        if (!isPauseLegalForSystem(initiative.state as LifecycleState)) {
          throw new Error(
            `initiative ${initiative.id} is in state '${initiative.state}', which does not permit 'system' to pause; skipping this breach candidate (identityKey ${evalResult.identityKey}).`,
          );
        }

        const detectedAt = new Date(nowTs);
        const windowStart = new Date(evalResult.windowStartTs!);

        // 1. Pause the deployment + initiative. `transition()` only permits
        // 'admin' or 'system' to pause/open_reassessment (lifecycle/transitions.ts),
        // but `runMonitor` itself can be triggered by any session role (task
        // brief: "POST /api/monitor/run — session, any role"). The lifecycle
        // authority is always the automated monitor (`system`), matching
        // initiative-service.ts's established pattern (e.g. `triage()`
        // defaults to SYSTEM_ACTOR for its own system-authority sub-steps);
        // the *triggering* `actor` passed into `runMonitor` is preserved in
        // the incident's audit metadata below for traceability, never used to
        // satisfy the transition's role check.
        const reason = `Q-01 eval-quality breach: ${def.observationKind ?? "eval_hallucination"} exceeded threshold ${threshold} for ${control.sustainedWindow} consecutive observations starting ${windowStart.toISOString()}.`;

        const depPauseResult = transition(
          initiative.state as LifecycleState,
          "pause",
          SYSTEM_ACTOR,
          { ts: nowTs, reason },
        );
        // Compare-and-set (external-review finding P2-5b): only advance the
        // initiative's state if it is STILL the state this candidate's scan
        // observed (`initiative.state`) — mirrors initiative-service.ts's
        // decide()/signReview() and admin-service.ts's pauseDeployment. On a
        // 0-row result, the initiative changed concurrently since the
        // candidate scan; treat it as THIS candidate's failure (caught below,
        // recorded in `errors`) rather than corrupting/aborting the run.
        const pausedInitiative = await tx
          .update(initiatives)
          .set({ state: depPauseResult.after, updatedAt: new Date(nowTs) })
          .where(and(eq(initiatives.id, initiative.id), eq(initiatives.state, initiative.state)))
          .returning();
        if (pausedInitiative.length === 0) {
          throw new ConflictError(
            `initiative ${initiative.id} changed concurrently (expected state '${initiative.state}')`,
          );
        }
        await insertAuditEvent(
          tx,
          initiative.id,
          depPauseResult.auditEvent,
          `Deployment ${deployment.id} paused automatically: ${reason}`,
          {
            deploymentId: deployment.id,
            controlId: RUNTIME_CONTROL_ID,
            identityKey: evalResult.identityKey,
            triggeredBy: { id: actor.id, role: actor.role },
          },
        );
        await tx
          .update(deploymentVersions)
          .set({ status: "paused", pausedAt: new Date(nowTs) })
          .where(eq(deploymentVersions.id, deployment.id));

        // 2. Open reassessment review cycle (paused -> re_review).
        const reassessResult = transition(
          depPauseResult.after,
          "open_reassessment",
          SYSTEM_ACTOR,
          { ts: nowTs },
        );
        await tx
          .update(initiatives)
          .set({ state: reassessResult.after, updatedAt: new Date(nowTs) })
          .where(eq(initiatives.id, initiative.id));

        const raRows = await tx
          .select()
          .from(riskAssessments)
          .where(eq(riskAssessments.initiativeId, initiative.id));
        const latestRa = raRows.slice().sort((a, b) => b.version - a.version)[0];

        // FK hazard guard (external-review finding P2-9): review_cycles.risk_assessment_id
        // is NOT NULL FK'd to risk_assessments.id — a deployed initiative with
        // no risk assessment row (should not happen in practice, but is not
        // structurally prevented) must never silently insert "" and fail with
        // an opaque FK violation mid-transaction. Fail loudly with a
        // descriptive error instead; caught by the per-candidate try/catch
        // above and recorded in `errors`, so the rest of the run proceeds.
        if (!latestRa) {
          throw new Error(
            `initiative ${initiative.id} (deployment ${deployment.id}) has a Q-01 breach but no risk assessment on file; cannot open a reassessment review cycle`,
          );
        }

        const reviewCycleId = `cycle-${randomUUID()}`;
        await tx.insert(reviewCycles).values({
          id: reviewCycleId,
          initiativeId: initiative.id,
          kind: "reassessment",
          riskAssessmentId: latestRa.id,
          openedAt: new Date(nowTs),
          closedAt: null,
          incidentId: null, // set below once the incident id is known
        });
        await insertAuditEvent(
          tx,
          initiative.id,
          reassessResult.auditEvent,
          `Reassessment review cycle ${reviewCycleId} opened for control ${RUNTIME_CONTROL_ID} breach.`,
          { reviewCycleId, controlId: RUNTIME_CONTROL_ID },
        );

        // 3. Incident summary narration (deterministic detection already
        // decided above; the agent only narrates it).
        const domain = (def.domain === "runtime" ? "responsible-ai" : def.domain) as GovernanceDomain;
        const incidentSummaryMd = await generateIncidentSummary({
          controlId: RUNTIME_CONTROL_ID,
          initiativeId: initiative.id,
          domain,
        });

        // 4. Incident row (idempotency anchor).
        const incidentId = `incident-${randomUUID()}`;
        await tx.insert(incidents).values({
          id: incidentId,
          deploymentId: deployment.id,
          controlId: RUNTIME_CONTROL_ID,
          windowStart,
          identityKey: evalResult.identityKey!,
          detectedAt,
          reviewCycleId,
          resolvedAt: null,
        });
        await tx
          .update(reviewCycles)
          .set({ incidentId })
          .where(eq(reviewCycles.id, reviewCycleId));
        await tx
          .update(effectiveControls)
          .set({ status: "breached" })
          .where(eq(effectiveControls.id, ec.id));

        await tx.insert(auditEvents).values({
          id: `evt-${randomUUID()}`,
          initiativeId: initiative.id,
          ts: detectedAt,
          actor: actor.id,
          actorRole: actor.role,
          action: "incident_recorded",
          detail: incidentSummaryMd,
          before: null,
          after: null,
          metadata: {
            incidentId,
            deploymentId: deployment.id,
            controlId: RUNTIME_CONTROL_ID,
            identityKey: evalResult.identityKey,
            windowStartTs: evalResult.windowStartTs,
          },
        });

        return { isNew: true, incidentId, reviewCycleId };
      });

      if (outcome.isNew) incidentsCreated += 1;
      else alreadyKnown += 1;

      breaches.push({
        initiativeId: initiative.id,
        deploymentId: deployment.id,
        controlId: RUNTIME_CONTROL_ID,
        windowStartTs: evalResult.windowStartTs,
        identityKey: evalResult.identityKey,
        threshold,
        breachingValues: evalResult.breachingObservations.map((o) => o.value),
        isNew: outcome.isNew,
        incidentId: outcome.incidentId,
        reviewCycleId: outcome.reviewCycleId,
      });
    } catch (err) {
      errors.push({
        initiativeId: initiative.id,
        deploymentId: deployment.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { evaluated, breaches, incidentsCreated, alreadyKnown, errors };
}

/* -------------------------------------------------------------------------
 * Public read-only incident list (GET /api/monitor/incidents)
 * ---------------------------------------------------------------------- */

export interface IncidentListRow {
  id: string;
  deploymentId: string;
  controlId: string;
  windowStart: string;
  detectedAt: string;
  reviewCycleId: string | null;
  resolvedAt: string | null;
}

export async function listIncidents(db: Db): Promise<IncidentListRow[]> {
  const rows = await db.select().from(incidents);
  return rows
    .slice()
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
    .map((r) => ({
      id: r.id,
      deploymentId: r.deploymentId,
      controlId: r.controlId,
      windowStart: r.windowStart.toISOString(),
      detectedAt: r.detectedAt.toISOString(),
      reviewCycleId: r.reviewCycleId,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }));
}
