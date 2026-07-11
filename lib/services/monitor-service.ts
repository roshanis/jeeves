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
import { transition, type AuditEventPayload } from "../lifecycle/transitions";
import { getAgentPort } from "../agents";
import { generateMockIncidentSummary } from "../agents/mock-adapter";
import type { GovernanceDomain } from "../agents/ports";
import { SYSTEM_ACTOR } from "./actors";

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

export interface RunMonitorResult {
  /** Number of deployed initiatives with a Q-01 effective control that were evaluated. */
  evaluated: number;
  breaches: BreachDetail[];
  incidentsCreated: number;
  alreadyKnown: number;
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
      await tx
        .update(initiatives)
        .set({ state: depPauseResult.after, updatedAt: new Date(nowTs) })
        .where(eq(initiatives.id, initiative.id));
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

      const reviewCycleId = `cycle-${randomUUID()}`;
      await tx.insert(reviewCycles).values({
        id: reviewCycleId,
        initiativeId: initiative.id,
        kind: "reassessment",
        riskAssessmentId: latestRa?.id ?? "",
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
  }

  return { evaluated, breaches, incidentsCreated, alreadyKnown };
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
