/**
 * RL/version-promotion service (plan.md M3: "interactive RL promotion view
 * (runs, reward curves, feedback-provenance sign-off)"; docs/seed-spec.md
 * #5 `pa-correspondence-model`: "Deployed v2.0; v2.1 checkpoint awaiting
 * feedback-provenance sign-off (promotion gate)").
 *
 * JUDGMENT CALL 1 — this is NOT a `LifecycleState` transition. The initiative
 * itself stays in state `"deployed"` throughout promotion (its `state`
 * column never changes here); only the `deployment_versions.status` column
 * flips, between the deployment-scoped vocabulary `'deployed' | 'paused' |
 * 'awaiting_promotion_signoff' | 'retired'` (lib/db/schema.ts). That
 * vocabulary is DISTINCT from `LifecycleState` (lib/domain/types.ts), which
 * has no `"awaiting_promotion_signoff"` member. Because of that, this module
 * never calls `lib/lifecycle/transitions.ts`'s `transition()` — there is no
 * `LifecycleAction` that fits "promote a checkpoint", and forcing one in
 * would misrepresent the initiative's own lifecycle state. Contrast with
 * `admin-service.ts`'s `pauseDeployment`/`resumeDeployment`, which DO call
 * `transition()` because pause/resume happen to correspond to real
 * `LifecycleState` members (`deployed` <-> `paused`).
 *
 * JUDGMENT CALL 2 — role guard. `admin-service.ts` defines its own
 * `ForbiddenError`/`ValidationError`/`NotFoundError` local to that file
 * rather than reusing `IllegalTransitionError` for its role/reason guard
 * (`requireAdminWithReason`), and only re-exports `IllegalTransitionError`
 * for the `transition()`-driven state violations in pause/resume. This
 * module follows that exact precedent: its own `ForbiddenError`/
 * `ValidationError`/`NotFoundError` classes below, defined fresh (not
 * imported from admin-service.ts, to keep this file's public error surface
 * self-contained for its own callers/route handlers — importing them would
 * have worked too, but duplicating three tiny classes is cheaper than a
 * cross-file coupling for an unrelated action). Unlike admin-service.ts's
 * `requireAdminWithReason` (role `"admin"`), this module's guard requires
 * role `"approver"` — Separation of Duties: promoting a checkpoint is a
 * sign-off/attestation act, structurally the same authority class as
 * approve/reject/sign in `initiative-service.ts`, which is approver-only.
 * Admin and reviewer are both explicitly rejected.
 *
 * JUDGMENT CALL 3 — double-promote / "already settled" error. There is no
 * `LifecycleAction` for this either, so `IllegalTransitionError` doesn't fit
 * cleanly (it requires a `LifecycleState`/`LifecycleAction` pair). This
 * module reuses `ValidationError` with a message naming the current status,
 * rather than inventing a fourth error class — one extra typed error for a
 * single call site was judged not worth it, and every other
 * service-error-to-HTTP mapping in this codebase (admin-service.ts's
 * `ValidationError` -> 400) already gives route handlers a clean, typed,
 * catchable 400 for "this request is well-formed but not currently valid."
 *
 * JUDGMENT CALL 4 — "prior deployed version to supersede". Simplified from
 * `db-provider.ts`'s `operationalDeployment` (latest-by-deployedAt among
 * `deployed`/`paused` rows, falling back to the latest of any status) to:
 * "the initiative's current row(s) with `status === 'deployed'`" — promotion
 * specifically only ever supersedes a live, serving version, never a
 * `paused` one (a paused version isn't "in production" to be superseded;
 * an admin would resume-then-let-promotion-retire-it, or the operator
 * promotes over top and the paused row is simply left paused/orphaned,
 * which is out of scope for this demo). If more than one `deployed` row
 * exists for the initiative (shouldn't happen in the seeded data, but not
 * structurally prevented by the schema), the latest-by-deployedAt one is
 * retired, matching `operationalDeployment`'s ordering.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { auditEvents, deploymentVersions, initiatives } from "../db/schema";
import type { Actor } from "../domain/types";

/**
 * requireApproverOrAdminWithReason — SoD guard for `rollbackDeployment` (M3
 * promotion-view extension). Deliberately DISTINCT from
 * `requireApproverWithAttestation` above (promotion is an approver-only
 * attestation act) because a rollback is an operational remediation action,
 * structurally closer to `admin-service.ts`'s `pauseDeployment`/
 * `resumeDeployment` (admin-gated) than to a sign-off — but since rolling
 * back also un-does a promotion decision an approver made, both roles are
 * accepted here. Reuses THIS file's own `ForbiddenError`/`ValidationError`
 * (not `IllegalTransitionError` from lib/lifecycle/transitions.ts, which
 * requires a `LifecycleState`/`LifecycleAction` pair that doesn't exist for
 * deployment-version-scoped rollback — same rationale as JUDGMENT CALL 2/3
 * above for promoteCheckpoint).
 */
function requireApproverOrAdminWithReason(actor: Actor, reason: string): void {
  if (actor.role !== "approver" && actor.role !== "admin") {
    throw new ForbiddenError(
      `deployment rollback requires role 'approver' or 'admin'; actor role is '${actor.role}'`,
    );
  }
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("deployment rollback requires a non-empty reason");
  }
}

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

function requireApproverWithAttestation(
  actor: Actor,
  attestation: ProvenanceAttestation,
  reason: string,
): void {
  if (actor.role !== "approver") {
    throw new ForbiddenError(
      `checkpoint promotion requires role 'approver'; actor role is '${actor.role}'`,
    );
  }

  const issues: string[] = [];
  if (!attestation.feedbackDataSource || attestation.feedbackDataSource.trim().length === 0) {
    issues.push("feedbackDataSource");
  }
  if (!attestation.consentBasis || attestation.consentBasis.trim().length === 0) {
    issues.push("consentBasis");
  }
  if (!attestation.reviewedBy || attestation.reviewedBy.trim().length === 0) {
    issues.push("reviewedBy");
  }
  if (!reason || reason.trim().length === 0) {
    issues.push("reason");
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `checkpoint promotion requires a complete provenance attestation and reason; missing/empty field(s): ${issues.join(", ")}`,
      issues,
    );
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
 * 1. listPromotions
 * ---------------------------------------------------------------------- */

export interface PromotionListItem {
  deploymentVersionId: string;
  initiativeId: string;
  initiativeSlug: string;
  initiativeTitle: string;
  tier: string | null;
  version: string;
  modelVersion: string | null;
  feedbackProvenanceSignedOff: boolean;
  deployedAt: string;
  /** The version string of the currently-deployed row this checkpoint would supersede, if any. */
  supersedesVersion: string | null;
}

/**
 * Every `deployment_versions` row with `status === "awaiting_promotion_signoff"`,
 * joined in memory with its initiative (slug/title/tier) and the version
 * string of the initiative's current `deployed` row (if any) — following
 * db-provider.ts's "load full tables, join in memory" style, appropriate for
 * this small demo dataset.
 */
export async function listPromotions(db: Db): Promise<PromotionListItem[]> {
  const [allDeployments, allInitiatives] = await Promise.all([
    db.select().from(deploymentVersions),
    db.select().from(initiatives),
  ]);

  const initiativeById = new Map(allInitiatives.map((i) => [i.id, i]));

  const awaiting = allDeployments.filter((d) => d.status === "awaiting_promotion_signoff");

  return awaiting.map((d) => {
    const initiative = initiativeById.get(d.initiativeId);
    const currentDeployed = allDeployments
      .filter((other) => other.initiativeId === d.initiativeId && other.status === "deployed")
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];

    return {
      deploymentVersionId: d.id,
      initiativeId: d.initiativeId,
      initiativeSlug: initiative?.slug ?? "",
      initiativeTitle: initiative?.title ?? "",
      tier: initiative?.tier ?? null,
      version: d.version,
      modelVersion: d.modelVersion ?? null,
      feedbackProvenanceSignedOff: d.feedbackProvenanceSignedOff,
      deployedAt: d.deployedAt.toISOString(),
      supersedesVersion: currentDeployed?.version ?? null,
    };
  });
}

/* -------------------------------------------------------------------------
 * 2. promoteCheckpoint
 * ---------------------------------------------------------------------- */

export interface ProvenanceAttestation {
  feedbackDataSource: string;
  consentBasis: string;
  reviewedBy: string;
}

export interface PromoteCheckpointResult {
  initiativeId: string;
  promotedDeploymentVersionId: string;
  promotedVersion: string;
  supersededDeploymentVersionId: string | null;
  supersededVersion: string | null;
  status: "deployed";
}

/**
 * Promote an RL checkpoint (`deployment_versions.status ===
 * "awaiting_promotion_signoff"`) to live (`"deployed"`), after a human
 * approver attests to the feedback-data provenance and consent basis.
 * Rules (enforced in order):
 *
 *  1. Role: `actor.role` must be exactly `"approver"`. `"admin"`,
 *     `"reviewer"`, and every other role are rejected with `ForbiddenError`
 *     (Separation of Duties). Checked before opening a transaction, matching
 *     `admin-service.ts#requireAdminWithReason`'s precedent.
 *  2. Attestation completeness: `provenanceAttestation.feedbackDataSource`,
 *     `.consentBasis`, `.reviewedBy`, and `reason` must all be non-empty
 *     (after `.trim()`). Missing/empty fields throw `ValidationError` naming
 *     which field(s) are missing (via its `issues: string[]`).
 *  3. Target existence + state: the `deployment_versions` row named by
 *     `deploymentVersionId` must exist (`NotFoundError` if not) and must
 *     currently have `status === "awaiting_promotion_signoff"`
 *     (`ValidationError` otherwise — covers the idempotent double-promote
 *     case; see file-level "JUDGMENT CALL 3").
 *  4. Supersede: the initiative's current `status === "deployed"` row (if
 *     any; see file-level "JUDGMENT CALL 4") is flipped to `"retired"` with
 *     `retiredAt` stamped.
 *  5. Promote: the target row is flipped to `status: "deployed"`,
 *     `feedbackProvenanceSignedOff: true`, and `deployedAt` re-stamped to
 *     now (keeps `db-provider.ts`'s `operationalDeployment` latest-by-
 *     `deployedAt` ordering correct going forward).
 *  6. Audit, transactionally: two `audit_events` rows are inserted in the
 *     SAME `db.transaction()` as the status flips — one for the retirement
 *     of the superseded version (`action: "deployment_version_retired"`),
 *     one for the promotion itself (`action: "checkpoint_promoted"`,
 *     `metadata` carrying the full attestation + reason + promoted/
 *     superseded version strings).
 *  7. Returns a `PromoteCheckpointResult`.
 */
export async function promoteCheckpoint(
  db: Db,
  deploymentVersionId: string,
  actor: Actor,
  provenanceAttestation: ProvenanceAttestation,
  reason: string,
): Promise<PromoteCheckpointResult> {
  requireApproverWithAttestation(actor, provenanceAttestation, reason);

  return db.transaction(async (tx) => {
    const targetRows = await tx
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.id, deploymentVersionId));
    const target = targetRows[0];
    if (!target) throw new NotFoundError("deploymentVersion", deploymentVersionId);

    if (target.status !== "awaiting_promotion_signoff") {
      throw new ValidationError(
        `deployment version ${deploymentVersionId} is not awaiting promotion sign-off (current status: '${target.status}'); it may already have been promoted`,
      );
    }

    const ts = Date.now();

    const siblingRows = await tx
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.initiativeId, target.initiativeId));
    const currentDeployed = siblingRows
      .filter((d) => d.status === "deployed")
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];

    if (currentDeployed) {
      await tx
        .update(deploymentVersions)
        .set({ status: "retired", retiredAt: new Date(ts) })
        .where(eq(deploymentVersions.id, currentDeployed.id));

      await insertAuditEvent(
        tx,
        target.initiativeId,
        actor,
        "deployment_version_retired",
        currentDeployed.status,
        "retired",
        `${actor.id} retired deployment ${currentDeployed.id} (${currentDeployed.version}), superseded by promoted checkpoint ${target.version}.`,
        ts,
        { deploymentId: currentDeployed.id, version: currentDeployed.version, supersededBy: target.version },
      );
    }

    await tx
      .update(deploymentVersions)
      .set({ status: "deployed", feedbackProvenanceSignedOff: true, deployedAt: new Date(ts) })
      .where(eq(deploymentVersions.id, target.id));

    await insertAuditEvent(
      tx,
      target.initiativeId,
      actor,
      "checkpoint_promoted",
      "awaiting_promotion_signoff",
      "deployed",
      `${actor.id} promoted checkpoint ${target.version} to deployed: ${reason}`,
      ts,
      {
        deploymentId: target.id,
        promotedVersion: target.version,
        supersededVersion: currentDeployed?.version ?? null,
        supersededDeploymentVersionId: currentDeployed?.id ?? null,
        provenanceAttestation,
        reason,
      },
    );

    return {
      initiativeId: target.initiativeId,
      promotedDeploymentVersionId: target.id,
      promotedVersion: target.version,
      supersededDeploymentVersionId: currentDeployed?.id ?? null,
      supersededVersion: currentDeployed?.version ?? null,
      status: "deployed" as const,
    };
  });
}

/* -------------------------------------------------------------------------
 * 3. deploymentHistory (M3 promotion-view extension — read-only)
 * ---------------------------------------------------------------------- */

export interface DeploymentHistoryEntry {
  id: string;
  version: string;
  status: "deployed" | "paused" | "awaiting_promotion_signoff" | "retired";
  modelVersion: string | null;
  deployedAt: string;
  pausedAt: string | null;
  retiredAt: string | null;
  /** True for the single row (if any) with status === "deployed" for this initiative. */
  isCurrent: boolean;
}

/**
 * All `deployment_versions` rows for `initiativeId`, newest-first by
 * `deployedAt`. Public/read-only — no actor/role gating (mirrors
 * `listPromotions`'s "no route is role-scoped" posture for reads). Returns
 * `[]` for an unknown initiative id rather than throwing, since this is a
 * pure read helper meant to back an always-rendered timeline panel (the
 * caller decides how to present "no history").
 */
export async function deploymentHistory(
  db: Db,
  initiativeId: string,
): Promise<DeploymentHistoryEntry[]> {
  const rows = await db
    .select()
    .from(deploymentVersions)
    .where(eq(deploymentVersions.initiativeId, initiativeId));

  return rows
    .slice()
    .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())
    .map((d) => ({
      id: d.id,
      version: d.version,
      status: d.status as DeploymentHistoryEntry["status"],
      modelVersion: d.modelVersion ?? null,
      deployedAt: d.deployedAt.toISOString(),
      pausedAt: d.pausedAt ? d.pausedAt.toISOString() : null,
      retiredAt: d.retiredAt ? d.retiredAt.toISOString() : null,
      isCurrent: d.status === "deployed",
    }));
}

/* -------------------------------------------------------------------------
 * 4. rollbackDeployment (M3 promotion-view extension — mutation)
 * ---------------------------------------------------------------------- */

export interface RollbackDeploymentResult {
  initiativeId: string;
  fromDeploymentVersionId: string;
  fromVersion: string;
  toDeploymentVersionId: string;
  toVersion: string;
  status: "deployed";
}

/**
 * Roll an initiative's live deployment back to a prior version. Rules
 * (enforced in order):
 *
 *  1. Role: `actor.role` must be `"approver"` or `"admin"` (SoD — see
 *     `requireApproverOrAdminWithReason` above); every other role is
 *     rejected with `ForbiddenError`.
 *  2. Reason: `reason` must be non-empty after `.trim()` (`ValidationError`
 *     otherwise). Checked before opening a transaction, matching
 *     `promoteCheckpoint`'s precedent of validating actor/input up front.
 *  3. Initiative existence: `initiativeId` must resolve to a real
 *     `initiatives` row (`NotFoundError` if not).
 *  4. Current version: the initiative's current `status === "deployed"` row
 *     must exist (`ValidationError` if there is no current deployed version
 *     to roll back FROM — nothing is live to supersede).
 *  5. Target version: `targetDeploymentVersionId` must name a
 *     `deployment_versions` row that (a) exists (`NotFoundError` if not),
 *     (b) belongs to the SAME initiative (`ValidationError` if it belongs to
 *     a different initiative — never allow cross-initiative rollback), and
 *     (c) currently has `status === "retired"` or `status === "paused"`
 *     (`ValidationError` otherwise — e.g. targeting the already-current
 *     deployed row, or an awaiting-signoff checkpoint that was never live).
 *  6. Flip, transactionally: the current `deployed` row becomes `"retired"`
 *     (`retiredAt` stamped); the target row becomes `"deployed"`
 *     (`retiredAt`/`pausedAt` cleared, `deployedAt` re-stamped to now).
 *  7. Audit, in the SAME transaction: one `audit_events` row,
 *     `action: "deployment_rolled_back"`, `before`/`after` = the version
 *     STRINGS being superseded/restored (not status enum values — the task
 *     brief specifies "before/after = version strings" for this action,
 *     distinct from `promoteCheckpoint`'s events which use status values;
 *     the version strings are the more useful audit signal for "what did we
 *     roll back to"), `metadata: { fromVersion, toVersion, reason }`.
 *  8. Returns a `RollbackDeploymentResult`.
 */
export async function rollbackDeployment(
  db: Db,
  initiativeId: string,
  actor: Actor,
  targetDeploymentVersionId: string,
  reason: string,
): Promise<RollbackDeploymentResult> {
  requireApproverOrAdminWithReason(actor, reason);

  return db.transaction(async (tx) => {
    const initiativeRows = await tx
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, initiativeId));
    if (!initiativeRows[0]) throw new NotFoundError("initiative", initiativeId);

    const siblingRows = await tx
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.initiativeId, initiativeId));

    const currentDeployed = siblingRows
      .filter((d) => d.status === "deployed")
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];
    if (!currentDeployed) {
      throw new ValidationError(
        `initiative ${initiativeId} has no currently-deployed version to roll back`,
      );
    }

    const priorCandidates = siblingRows.filter(
      (d) => d.id !== currentDeployed.id && (d.status === "retired" || d.status === "paused"),
    );
    if (priorCandidates.length === 0) {
      throw new ValidationError(
        `initiative ${initiativeId} has no prior (retired or paused) deployment version to roll back to`,
      );
    }

    const target = siblingRows.find((d) => d.id === targetDeploymentVersionId);
    if (!target) throw new NotFoundError("deploymentVersion", targetDeploymentVersionId);

    if (target.id === currentDeployed.id) {
      throw new ValidationError(
        `deployment version ${targetDeploymentVersionId} is already the current deployed version`,
      );
    }
    if (target.status !== "retired" && target.status !== "paused") {
      throw new ValidationError(
        `deployment version ${targetDeploymentVersionId} is not a prior (retired or paused) version of initiative ${initiativeId} (current status: '${target.status}')`,
      );
    }

    const ts = Date.now();

    await tx
      .update(deploymentVersions)
      .set({ status: "retired", retiredAt: new Date(ts) })
      .where(eq(deploymentVersions.id, currentDeployed.id));

    await tx
      .update(deploymentVersions)
      .set({ status: "deployed", deployedAt: new Date(ts), retiredAt: null, pausedAt: null })
      .where(eq(deploymentVersions.id, target.id));

    await insertAuditEvent(
      tx,
      initiativeId,
      actor,
      "deployment_rolled_back",
      currentDeployed.version,
      target.version,
      `${actor.id} rolled back deployment from ${currentDeployed.version} to ${target.version}: ${reason}`,
      ts,
      { fromVersion: currentDeployed.version, toVersion: target.version, reason },
    );

    return {
      initiativeId,
      fromDeploymentVersionId: currentDeployed.id,
      fromVersion: currentDeployed.version,
      toDeploymentVersionId: target.id,
      toVersion: target.version,
      status: "deployed" as const,
    };
  });
}
