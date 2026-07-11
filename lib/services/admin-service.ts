/**
 * The two live admin actions (plan.md §2 step 8, §9 P3; task brief
 * deliverable 2): change an eval threshold, and pause/resume a deployment.
 * Both REQUIRE role `admin` + a non-empty `reason`, and both write
 * before/after `AuditEvent`s. Admin can never approve/sign — there is no
 * such method here, and `decide()`/`signReview()`/`returnReview()` in
 * `initiative-service.ts` already reject a non-approver/non-reviewer actor
 * via `transition()`'s role table (pinned from this module's test file so a
 * regression in that separation-of-duties guarantee is caught from the
 * admin surface too, not just initiative-service's own tests).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { auditEvents, controlDefinitions, deploymentVersions, effectiveControls, initiatives } from "../db/schema";
import type { Actor, LifecycleState, Tier } from "../domain/types";
import { transition, IllegalTransitionError } from "../lifecycle/transitions";

/**
 * Re-exported so route handlers can catch a STATE violation (e.g. pausing an
 * already-paused deployment) by type without importing lifecycle/transitions
 * directly. Never thrown for a ROLE violation here — `requireAdminWithReason`
 * already rejects a non-admin actor (as `ForbiddenError`) before `transition()`
 * is ever called, so any `IllegalTransitionError` surfaced by this module is
 * always about the *state*, not who is calling.
 */
export { IllegalTransitionError };

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

function requireAdminWithReason(actor: Actor, reason: string): void {
  if (actor.role !== "admin") {
    throw new ForbiddenError(`admin action requires role 'admin'; actor role is '${actor.role}'`);
  }
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("admin action requires a non-empty reason");
  }
}

function insertAuditEvent(
  tx: Tx,
  initiativeId: string | null,
  actor: Actor,
  action: string,
  before: string | null,
  after: string | null,
  detail: string,
  ts: number,
  metadata?: Record<string, unknown>,
): Promise<unknown> {
  return tx.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(ts),
    actor: actor.id,
    actorRole: actor.role,
    action,
    detail,
    before,
    after,
    metadata: metadata ?? null,
  });
}

/* -------------------------------------------------------------------------
 * 1. setEvalThreshold
 * ---------------------------------------------------------------------- */

export interface SetEvalThresholdInput {
  controlId: string;
  /** Project/deployment-level override target; `null` changes the tier default instead. */
  initiativeId: string | null;
  /**
   * Required only when `initiativeId` is `null` (tier-default change) — the
   * `tierDefaultThresholds` map (lib/db/schema.ts) is keyed per tier, so a
   * "no initiative" threshold change must name which tier's default it is
   * tightening/loosening (mirrors the seeded historical precedent,
   * `docs/seed-spec.md` §5: "tightened Q-01 ... for the High tier"). Ignored
   * when `initiativeId` is set (the override always applies to that
   * initiative's own deployment regardless of tier).
   */
  tier?: Tier;
  newValue: number;
  reason: string;
}

export interface SetEvalThresholdResult {
  controlId: string;
  scope: "tier-default" | "project-override";
  tier?: Tier;
  initiativeId?: string;
  before: number | null;
  after: number;
}

/**
 * Admin-only (+ reason) threshold change. Writes the new value (tier
 * default in `control_definitions.tier_default_thresholds`, or a per-
 * deployment override in `effective_controls.threshold_override`) and a
 * before/after `AuditEvent`, transactionally. A later `runMonitor` call
 * picks up the change automatically via `resolveThreshold` (project
 * override > tier default) — no separate wiring needed.
 */
export async function setEvalThreshold(
  db: Db,
  actor: Actor,
  input: SetEvalThresholdInput,
): Promise<SetEvalThresholdResult> {
  requireAdminWithReason(actor, input.reason);

  return db.transaction(async (tx) => {
    const defRows = await tx.select().from(controlDefinitions).where(eq(controlDefinitions.id, input.controlId));
    const def = defRows[0];
    if (!def) throw new NotFoundError("controlDefinition", input.controlId);

    const ts = Date.now();

    if (input.initiativeId === null) {
      if (!input.tier) {
        throw new ValidationError("setEvalThreshold: tier is required when initiativeId is null (tier-default change)");
      }
      const currentDefaults = (def.tierDefaultThresholds ?? {}) as Record<string, number>;
      const before = currentDefaults[input.tier] ?? null;
      const nextDefaults = { ...currentDefaults, [input.tier]: input.newValue };

      await tx
        .update(controlDefinitions)
        .set({ tierDefaultThresholds: nextDefaults })
        .where(eq(controlDefinitions.id, input.controlId));

      await insertAuditEvent(
        tx,
        null,
        actor,
        "control_threshold_changed",
        before === null ? null : String(before),
        String(input.newValue),
        `${actor.id} changed ${input.controlId}'s tier default (${input.tier}) from ${before ?? "unset"} to ${input.newValue}: ${input.reason}`,
        ts,
        { controlId: input.controlId, tier: input.tier, reason: input.reason, scope: "tier-default" },
      );

      return {
        controlId: input.controlId,
        scope: "tier-default",
        tier: input.tier,
        before,
        after: input.newValue,
      };
    }

    // Project/deployment override.
    const initiativeRows = await tx.select().from(initiatives).where(eq(initiatives.id, input.initiativeId));
    const initiative = initiativeRows[0];
    if (!initiative) throw new NotFoundError("initiative", input.initiativeId);

    const depRows = await tx
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.initiativeId, input.initiativeId));
    const deployment = depRows.slice().sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];
    if (!deployment) throw new NotFoundError("deploymentVersion for initiative", input.initiativeId);

    const ecRows = await tx
      .select()
      .from(effectiveControls)
      .where(
        and(eq(effectiveControls.deploymentId, deployment.id), eq(effectiveControls.controlId, input.controlId)),
      );
    const ec = ecRows.slice().sort((a, b) => b.version - a.version)[0];
    if (!ec) throw new NotFoundError("effectiveControl", `${deployment.id}/${input.controlId}`);

    const before = ec.thresholdOverride ?? null;

    await tx
      .update(effectiveControls)
      .set({ thresholdOverride: input.newValue })
      .where(eq(effectiveControls.id, ec.id));

    await insertAuditEvent(
      tx,
      input.initiativeId,
      actor,
      "control_threshold_changed",
      before === null ? null : String(before),
      String(input.newValue),
      `${actor.id} changed ${input.controlId}'s threshold override for initiative ${input.initiativeId} from ${before ?? "tier default"} to ${input.newValue}: ${input.reason}`,
      ts,
      { controlId: input.controlId, initiativeId: input.initiativeId, reason: input.reason, scope: "project-override" },
    );

    return {
      controlId: input.controlId,
      scope: "project-override",
      initiativeId: input.initiativeId,
      before,
      after: input.newValue,
    };
  });
}

/* -------------------------------------------------------------------------
 * 2. pauseDeployment / resumeDeployment
 * ---------------------------------------------------------------------- */

export interface PauseResumeResult {
  initiativeId: string;
  deploymentId: string;
  before: LifecycleState;
  after: LifecycleState;
}

async function loadInitiativeAndDeploymentOrThrow(
  tx: Tx,
  initiativeId: string,
): Promise<{
  initiative: typeof initiatives.$inferSelect;
  deployment: typeof deploymentVersions.$inferSelect;
}> {
  const initiativeRows = await tx.select().from(initiatives).where(eq(initiatives.id, initiativeId));
  const initiative = initiativeRows[0];
  if (!initiative) throw new NotFoundError("initiative", initiativeId);

  const depRows = await tx.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
  const deployment = depRows.slice().sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];
  if (!deployment) throw new NotFoundError("deploymentVersion for initiative", initiativeId);

  return { initiative, deployment };
}

/**
 * Admin-only (+ reason) manual pause. Reuses `transition()` for the
 * role/reason authority check (deployed -> paused, `admin`|`system`,
 * non-empty reason) exactly as `runMonitor`'s automated pause does — this
 * function just supplies the human-triggered actor/reason instead of the
 * monitor's system-derived one.
 */
export async function pauseDeployment(
  db: Db,
  actor: Actor,
  initiativeId: string,
  reason: string,
): Promise<PauseResumeResult> {
  requireAdminWithReason(actor, reason);

  return db.transaction(async (tx) => {
    const { initiative, deployment } = await loadInitiativeAndDeploymentOrThrow(tx, initiativeId);
    const ts = Date.now();

    const result = transition(initiative.state as LifecycleState, "pause", actor, { ts, reason });

    await tx
      .update(initiatives)
      .set({ state: result.after, updatedAt: new Date(ts) })
      .where(eq(initiatives.id, initiativeId));
    await tx
      .update(deploymentVersions)
      .set({ status: "paused", pausedAt: new Date(ts) })
      .where(eq(deploymentVersions.id, deployment.id));

    await insertAuditEvent(
      tx,
      initiativeId,
      actor,
      result.auditEvent.action,
      result.auditEvent.before,
      result.auditEvent.after,
      `${actor.id} manually paused deployment ${deployment.id}: ${reason}`,
      ts,
      { deploymentId: deployment.id, reason },
    );

    return { initiativeId, deploymentId: deployment.id, before: result.before, after: result.after };
  });
}

/**
 * Admin-only (+ reason) manual resume. `transition()` accepts `resume` from
 * both `paused` and `re_review` (lifecycle/transitions.ts), both requiring a
 * non-empty reason — this covers both "just pause, resume" and "paused,
 * reassessment opened, resume once satisfied" flows identically.
 */
export async function resumeDeployment(
  db: Db,
  actor: Actor,
  initiativeId: string,
  reason: string,
): Promise<PauseResumeResult> {
  requireAdminWithReason(actor, reason);

  return db.transaction(async (tx) => {
    const { initiative, deployment } = await loadInitiativeAndDeploymentOrThrow(tx, initiativeId);
    const ts = Date.now();

    const result = transition(initiative.state as LifecycleState, "resume", actor, { ts, reason });

    await tx
      .update(initiatives)
      .set({ state: result.after, updatedAt: new Date(ts) })
      .where(eq(initiatives.id, initiativeId));
    await tx
      .update(deploymentVersions)
      .set({ status: "deployed", pausedAt: null })
      .where(eq(deploymentVersions.id, deployment.id));

    await insertAuditEvent(
      tx,
      initiativeId,
      actor,
      result.auditEvent.action,
      result.auditEvent.before,
      result.auditEvent.after,
      `${actor.id} resumed deployment ${deployment.id}: ${reason}`,
      ts,
      { deploymentId: deployment.id, reason },
    );

    return { initiativeId, deploymentId: deployment.id, before: result.before, after: result.after };
  });
}
