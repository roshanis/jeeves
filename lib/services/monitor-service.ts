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
 *   4. Formats the detected incident deterministically without initializing
 *      any AI adapter or making a provider call.
 *   5. Writes an AuditEvent for every transition, all inside one
 *      `db.transaction()` per breached deployment — a partial write (state
 *      changed, no incident row, or vice versa) must never be observable.
 *
 * `nowTs` is a REQUIRED parameter, never read from the wall clock, so a
 * demo/test can replay history deterministically and idempotently.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import {
  auditEvents,
  controlDefinitions,
  controlExceptions,
  deploymentVersions,
  effectiveControls,
  incidents,
  initiatives,
  observations,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
} from "../db/schema";
import type { Actor, Domain, LifecycleState, Observation, Tier } from "../domain/types";
import { evaluateControl, resolveThreshold, type EffectiveControl } from "../controls/evaluate";
import { transition, IllegalTransitionError, type AuditEventPayload } from "../lifecycle/transitions";
import { redactDbError } from "../db/redact-error";
import { currentControlRevisions } from "../controls/current-revisions";
import { SYSTEM_ACTOR } from "./actors";
import { enqueueReviewRequests } from "./notification-service";
import { ConflictError } from "./initiative-service";
import { viewerRowsFilter } from "./viewer-workspace";

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

/** Explicit scope for trusted system jobs that intentionally scan every workspace. */
export const UNSCOPED_WORKSPACE = Symbol("unscoped-workspace");
export type MonitorWorkspaceScope =
  | string
  | null
  | typeof UNSCOPED_WORKSPACE;

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
  /**
   * Present (and always `true`) only when this breach was genuinely
   * DETECTED by `evaluateControl` but its persistence transaction threw
   * (CAS conflict, the missing-risk-assessment FK guard, a DB hiccup, a
   * pre-flight pause-illegal skip, etc.) — the matching `RunMonitorError` in
   * `RunMonitorResult.errors` carries the failure detail. `incidentId` is
   * `""` and `reviewCycleId` is `null` in this case: nothing was actually
   * written. Never counted in `RunMonitorResult.incidentsCreated`.
   *
   * Additive-only (external-review P1 fix — a failed detection pass must
   * never render identically to a clean run): absent/`undefined` for every
   * successfully persisted breach, so existing consumers that never check
   * this field see no behavior change.
   */
  failed?: true;
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

async function hasRequestedException(tx: Tx, effectiveControlId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: controlExceptions.id })
    .from(controlExceptions)
    .where(and(eq(controlExceptions.effectiveControlId, effectiveControlId), eq(controlExceptions.status, "requested")))
    .limit(1);
  return rows.length > 0;
}

/** Deployments currently `deployed` with their owning initiative + tier + flags. */
async function loadDeployedCandidates(
  tx: Tx,
  workspaceScope: MonitorWorkspaceScope,
): Promise<
  Array<{
    deployment: typeof deploymentVersions.$inferSelect;
    initiative: typeof initiatives.$inferSelect;
    tier: Tier;
  }>
> {
  // One joined query with the workspace predicate in SQL. For a scoped run it
  // mirrors mutationWorkspaceMismatch: only rows whose workspace equals the
  // scope (null scope -> null rows), never other workspaces' deployments.
  const workspacePredicate =
    workspaceScope === UNSCOPED_WORKSPACE
      ? undefined
      : workspaceScope === null
        ? isNull(initiatives.workspaceId)
        : eq(initiatives.workspaceId, workspaceScope);
  const rows = await tx
    .select({ deployment: deploymentVersions, initiative: initiatives })
    .from(deploymentVersions)
    .innerJoin(initiatives, eq(initiatives.id, deploymentVersions.initiativeId))
    .where(and(eq(deploymentVersions.status, "deployed"), isNotNull(initiatives.tier), workspacePredicate));

  return rows.map(({ deployment, initiative }) => ({
    deployment,
    initiative,
    tier: initiative.tier as Tier,
  }));
}

/** Narration is a deterministic rendering of an already detected breach. */
function generateIncidentSummary(input: { controlId: string; initiativeId: string }): string {
  return `Control ${input.controlId} breached its threshold for initiative ${input.initiativeId}. Deployment paused and a reassessment ReviewCycle opened automatically.`;
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
  workspaceScope: MonitorWorkspaceScope,
): Promise<RunMonitorResult> {
  const candidates = await db.transaction(async (tx) =>
    loadDeployedCandidates(tx, workspaceScope),
  );

  const breaches: BreachDetail[] = [];
  const errors: RunMonitorError[] = [];
  let evaluated = 0;
  let incidentsCreated = 0;
  let alreadyKnown = 0;

  // Read once, outside the loop: the Q-01 definition and every candidate's
  // Q-01 effective-control revisions.
  const defRows = await db
    .select()
    .from(controlDefinitions)
    .where(eq(controlDefinitions.id, RUNTIME_CONTROL_ID));
  const def = defRows[0];
  const ecByDeployment = new Map<string, Array<typeof effectiveControls.$inferSelect>>();
  if (candidates.length > 0) {
    const allEcRows = await db
      .select()
      .from(effectiveControls)
      .where(
        and(
          inArray(effectiveControls.deploymentId, candidates.map((c) => c.deployment.id)),
          eq(effectiveControls.controlId, RUNTIME_CONTROL_ID),
        ),
      );
    for (const row of allEcRows) {
      const list = ecByDeployment.get(row.deploymentId) ?? [];
      list.push(row);
      ecByDeployment.set(row.deploymentId, list);
    }
  }

  // Q-01 is attached by the monitor, not at deploy time: the first time a
  // deployed initiative has an eval_hallucination series and no Q-01 yet.
  // Without eval data there is nothing to evaluate, so nothing is attached.
  if (def && candidates.length > 0) {
    const kind = def.observationKind ?? "eval_hallucination";
    const withData = new Set(
      (
        await db
          .selectDistinct({ deploymentId: observations.deploymentId })
          .from(observations)
          .where(and(inArray(observations.deploymentId, candidates.map((c) => c.deployment.id)), eq(observations.kind, kind)))
      ).map((r) => r.deploymentId),
    );
    for (const { deployment, initiative } of candidates) {
      if (!withData.has(deployment.id) || (ecByDeployment.get(deployment.id) ?? []).length > 0) continue;
      try {
        const attached = await db.transaction(async (tx) => {
          // Re-check inside the transaction so overlapping runs attach it once.
          const [existing] = await tx
            .select({ id: effectiveControls.id })
            .from(effectiveControls)
            .where(and(eq(effectiveControls.deploymentId, deployment.id), eq(effectiveControls.controlId, RUNTIME_CONTROL_ID)))
            .limit(1);
          if (existing) return null;
          const row = {
            id: `ec-${randomUUID()}`,
            deploymentId: deployment.id,
            controlId: RUNTIME_CONTROL_ID,
            version: 1,
            status: "pending",
            thresholdOverride: null,
            evidence: null,
            evidenceAt: null,
            dueAt: null,
            remediationOwner: def.remediationOwner,
            createdAt: new Date(),
          };
          await tx.insert(effectiveControls).values(row);
          await tx.insert(auditEvents).values({
            id: `evt-${randomUUID()}`,
            initiativeId: initiative.id,
            ts: new Date(),
            actor: SYSTEM_ACTOR.id,
            actorRole: SYSTEM_ACTOR.role,
            action: "effective_control_attached",
            detail: `Attached ${RUNTIME_CONTROL_ID} to deployment ${deployment.id}: eval data first seen.`,
            before: null,
            after: null,
            metadata: { controlId: RUNTIME_CONTROL_ID, deploymentId: deployment.id },
          });
          return row;
        });
        if (attached) ecByDeployment.set(deployment.id, [attached as typeof effectiveControls.$inferSelect]);
      } catch (err) {
        errors.push({ initiativeId: initiative.id, deploymentId: deployment.id, message: redactDbError(err).message });
      }
    }
  }

  for (const { deployment, initiative, tier } of candidates) {
    // Q-01 effective control (absent until the first eval_hallucination
    // observation is seen; attached just above).
    const ecRows = ecByDeployment.get(deployment.id) ?? [];
    if (ecRows.length === 0) continue;
    const ec = currentControlRevisions(ecRows)[0]!;

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

    // The first sustained run is reported (and stays alreadyKnown) until it is
    // a recorded incident; then look past the end of that run so a LATER breach
    // (e.g. after a resume) is detected instead of the old one found again.
    let evalResult = evaluateControl(control, series, nowTs);
    // End of the latest known breach run, and whether the series has moved
    // past a known breach (no later sustained breach).
    let since: number | undefined;
    let pastKnownBreach = false;
    if (evalResult.identityKey) {
      const known = await db.select().from(incidents).where(eq(incidents.deploymentId, deployment.id));
      const sorted = series.slice().sort((a, b) => a.ts - b.ts);
      for (const inc of known) {
        const startIdx = sorted.findIndex((o) => o.ts >= inc.windowStart.getTime());
        if (startIdx === -1) continue;
        let end = startIdx;
        while (end + 1 < sorted.length && sorted[end + 1]!.value > threshold) end += 1;
        if (since === undefined || sorted[end]!.ts > since) since = sorted[end]!.ts;
      }
      if (since !== undefined && known.some((k) => k.identityKey === evalResult.identityKey)) {
        const later = evaluateControl(control, series, nowTs, since);
        if (later.breached) evalResult = later;
        else pastKnownBreach = true;
      }
    }

    // A control reset to 'pending' (new Q-01, or after an approved
    // reassessment) becomes 'met' once there is a passing observation newer
    // than any known breach. A control with an open exception request is left
    // alone, as for a breach below.
    if (ec.status === "pending" && (!evalResult.breached || pastKnownBreach)) {
      const latest = series.filter((o) => o.ts <= nowTs).sort((a, b) => b.ts - a.ts)[0];
      if (latest && latest.value <= threshold && (since === undefined || latest.ts > since)) {
        await db.transaction(async (tx) => {
          if (await hasRequestedException(tx, ec.id)) return;
          const updated = await tx
            .update(effectiveControls)
            .set({ status: "met" })
            .where(and(eq(effectiveControls.id, ec.id), eq(effectiveControls.status, "pending")))
            .returning();
          if (updated.length === 0) return;
          await tx.insert(auditEvents).values({
            id: `evt-${randomUUID()}`,
            initiativeId: initiative.id,
            ts: new Date(),
            actor: SYSTEM_ACTOR.id,
            actorRole: SYSTEM_ACTOR.role,
            action: "control_met",
            detail: `${RUNTIME_CONTROL_ID} is met for deployment ${deployment.id}: passing evidence at ${new Date(latest.ts).toISOString()}.`,
            before: "pending",
            after: "met",
            metadata: { effectiveControlId: ec.id, controlId: RUNTIME_CONTROL_ID, deploymentId: deployment.id, evidenceTs: latest.ts },
          });
        });
      }
    }
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

        // Wall clock for stored timestamps; nowTs is only the observation cut-off.
        const wallTs = Date.now();
        const evaluatedAt = new Date(nowTs).toISOString();
        const detectedAt = new Date(wallTs);
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
          { ts: wallTs, reason },
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
          .set({ state: depPauseResult.after, updatedAt: new Date(wallTs) })
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
            evaluatedAt,
            triggeredBy: { id: actor.id, role: actor.role },
          },
        );
        // Compare-and-set on the scanned status (as admin-service's
        // pauseDeployment does): a promotion or rollback that retired this
        // version since the scan must not leave it 'paused' while the live
        // version stays deployed. 0 rows rolls the whole transaction back.
        const pausedDeployment = await tx
          .update(deploymentVersions)
          .set({ status: "paused", pausedAt: new Date(wallTs) })
          .where(and(eq(deploymentVersions.id, deployment.id), eq(deploymentVersions.status, "deployed")))
          .returning();
        if (pausedDeployment.length === 0) {
          throw new ConflictError(
            `deployment ${deployment.id} changed concurrently (expected status 'deployed')`,
          );
        }

        // 2. Open reassessment review cycle (paused -> re_review).
        const reassessResult = transition(
          depPauseResult.after,
          "open_reassessment",
          SYSTEM_ACTOR,
          { ts: wallTs },
        );
        await tx
          .update(initiatives)
          .set({ state: reassessResult.after, updatedAt: new Date(wallTs) })
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
          openedAt: new Date(wallTs),
          closedAt: null,
          incidentId: null, // set below once the incident id is known
        });
        // A cycle enters the same reviewer queue as initial submission. These
        // pending obligations are created atomically with its incident, with
        // no model calls or automatic human decisions.
        if (latestRa.requiredDomains.length > 0) {
          await tx.insert(reviewDecisions).values([...new Set(latestRa.requiredDomains)].map((domain) => ({
            id: `rd-${randomUUID()}`,
            cycleId: reviewCycleId,
            domain,
            status: "pending",
            createdAt: new Date(wallTs),
          })));
          // Same invariant as triage(): a review row never exists without a
          // recorded request for it. Idempotent via the unique index.
          await enqueueReviewRequests(tx, {
            initiativeId: initiative.id,
            initiativeTitle: initiative.title,
            cycleId: reviewCycleId,
            domains: [...new Set(latestRa.requiredDomains)] as Domain[],
            tier,
            now: wallTs,
          });
        }
        await insertAuditEvent(
          tx,
          initiative.id,
          reassessResult.auditEvent,
          `Reassessment review cycle ${reviewCycleId} opened for control ${RUNTIME_CONTROL_ID} breach.`,
          { reviewCycleId, controlId: RUNTIME_CONTROL_ID, evaluatedAt },
        );

        // 3. Narrate the already-detected breach without initializing an AI runtime.
        const incidentSummaryMd = generateIncidentSummary({
          controlId: RUNTIME_CONTROL_ID,
          initiativeId: initiative.id,
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
        // The incident is recorded either way; the control's status is not
        // overwritten while an exception request for it is open.
        if (!(await hasRequestedException(tx, ec.id))) {
          await tx
            .update(effectiveControls)
            .set({ status: "breached" })
            .where(eq(effectiveControls.id, ec.id));
        }

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
      // An overlapping run (cron retry vs manual) lost the state CAS because
      // the other run just committed this very incident: re-read it outside
      // the failed transaction and report it as already known, not a failure.
      if (err instanceof ConflictError) {
        const [recorded] = await db
          .select()
          .from(incidents)
          .where(eq(incidents.identityKey, evalResult.identityKey!));
        if (recorded) {
          alreadyKnown += 1;
          breaches.push({
            initiativeId: initiative.id,
            deploymentId: deployment.id,
            controlId: RUNTIME_CONTROL_ID,
            windowStartTs: evalResult.windowStartTs,
            identityKey: evalResult.identityKey,
            threshold,
            breachingValues: evalResult.breachingObservations.map((o) => o.value),
            isNew: false,
            incidentId: recorded.id,
            reviewCycleId: recorded.reviewCycleId,
          });
          continue;
        }
      }
      const message = redactDbError(err).message;
      // P1 fix (external-review — a failed detection pass rendered
      // identically to a clean run): a real deployment must leave a trace
      // in the server logs even when nothing else observes this run.
      console.error(
        `[monitor] breach detected but NOT persisted for initiative=${initiative.id} deployment=${deployment.id} identityKey=${evalResult.identityKey}: ${message}`,
      );
      errors.push({
        initiativeId: initiative.id,
        deploymentId: deployment.id,
        message,
      });
      // Make detection visible even though persistence failed: this breach
      // WAS detected (evalResult.breached above) — record it in `breaches`
      // with `failed: true` rather than silently dropping it. Not counted
      // in `incidentsCreated` below, since nothing was actually persisted.
      breaches.push({
        initiativeId: initiative.id,
        deploymentId: deployment.id,
        controlId: RUNTIME_CONTROL_ID,
        windowStartTs: evalResult.windowStartTs,
        identityKey: evalResult.identityKey,
        threshold,
        breachingValues: evalResult.breachingObservations.map((o) => o.value),
        isNew: false,
        incidentId: "",
        reviewCycleId: null,
        failed: true,
      });
    }
  }

  return { evaluated, breaches, incidentsCreated, alreadyKnown, errors };
}

/* -------------------------------------------------------------------------
 * Incident list (GET /api/monitor/incidents reads it via listIncidentsForViewer)
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

function toIncidentListRow(r: typeof incidents.$inferSelect): IncidentListRow {
  return {
    id: r.id,
    deploymentId: r.deploymentId,
    controlId: r.controlId,
    windowStart: r.windowStart.toISOString(),
    detectedAt: r.detectedAt.toISOString(),
    reviewCycleId: r.reviewCycleId,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

/**
 * Internal and UNSCOPED: every incident of every workspace, newest first.
 * Not for routes or pages (they must use `listIncidentsForViewer`); kept as
 * the unfiltered baseline the monitor tests compare against.
 */
export async function listIncidents(db: Db): Promise<IncidentListRow[]> {
  const rows = await db.select().from(incidents);
  return rows
    .slice()
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
    .map(toIncidentListRow);
}

/** Incidents of seeded deployments plus the viewer's own, newest first, filtered in SQL (an absent deployment/initiative is excluded by the inner joins). */
export async function listIncidentsForViewer(db: Db, viewerWorkspaceId: string | null): Promise<IncidentListRow[]> {
  const rows = await db
    .select({ incident: incidents })
    .from(incidents)
    .innerJoin(deploymentVersions, eq(incidents.deploymentId, deploymentVersions.id))
    .innerJoin(initiatives, eq(deploymentVersions.initiativeId, initiatives.id))
    .where(viewerRowsFilter(viewerWorkspaceId))
    .orderBy(desc(incidents.detectedAt));
  return rows.map((r) => toIncidentListRow(r.incident));
}
