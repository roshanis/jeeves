/**
 * Control-exception workflow (plan.md M4): a control that cannot currently be
 * met may run under a time-boxed, accountable EXCEPTION.
 *
 * Lifecycle:  request -> approve | reject
 *             approved -> revoke | renew | (auto) expire
 *
 * Separation of duties: anyone with a stake may REQUEST; only an approver or
 * admin may DECIDE / REVOKE, and never on an exception they requested
 * themselves. Every transition is written atomically with an `audit_events`
 * row (append-only at the DB level, migration 0002).
 *
 * The linked `effective_controls.status` reflects the exception: it moves to
 * `exception_requested` while an exception is active (requested OR approved),
 * and back to `overdue` on reject / revoke / expire. The precise exception
 * state (requested vs granted vs expired, expiry, who decided) lives on the
 * `control_exceptions` row — the effective-control status stays within its
 * existing enum so the read model / controls UI need no change.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { auditEvents, controlExceptions, deploymentVersions, effectiveControls } from "../db/schema";
import type { Actor } from "../domain/types";
import { NotFoundError, ValidationError, IllegalTransitionError } from "./initiative-service";

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Default validity window for an approved exception when none is supplied. */
const DEFAULT_EXCEPTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExceptionStatus = "requested" | "approved" | "rejected" | "revoked" | "expired";

export interface ExceptionResult {
  id: string;
  controlId: string;
  status: ExceptionStatus;
  expiresAt: number | null;
}

function nowTs(): number {
  return Date.now();
}

/** Only an approver or admin may decide/revoke an exception (SoD). */
function requireDecider(actor: Actor): void {
  if (actor.role !== "approver" && actor.role !== "admin") {
    throw new IllegalTransitionError(
      `only an approver or admin may decide a control exception; role '${actor.role}' is not permitted`,
      "in_review",
      "start_review",
      actor.role,
    );
  }
}

/** Resolve the owning initiative id for an effective control (ec -> deployment -> initiative), or null. */
async function initiativeIdForEffectiveControl(tx: Tx, deploymentId: string): Promise<string | null> {
  const [dep] = await tx
    .select({ initiativeId: deploymentVersions.initiativeId })
    .from(deploymentVersions)
    .where(eq(deploymentVersions.id, deploymentId));
  return dep?.initiativeId ?? null;
}

async function audit(
  tx: Tx,
  initiativeId: string | null,
  actor: Actor,
  action: string,
  detail: string,
  before: string | null,
  after: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(nowTs()),
    actor: actor.id,
    actorRole: actor.role,
    action,
    detail,
    before,
    after,
    metadata,
  });
}

/**
 * Request a time-boxed exception for an effective control. Any authenticated
 * actor may request (route-gated by session). Rejects if the control already
 * has an active (requested/approved) exception. Moves the effective control to
 * `exception_requested`.
 */
export async function requestException(
  db: Db,
  effectiveControlId: string,
  actor: Actor,
  reason: string,
): Promise<ExceptionResult> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception request requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [ec] = await tx.select().from(effectiveControls).where(eq(effectiveControls.id, effectiveControlId));
    if (!ec) throw new NotFoundError("effectiveControl", effectiveControlId);

    const active = await tx
      .select()
      .from(controlExceptions)
      .where(
        and(
          eq(controlExceptions.effectiveControlId, effectiveControlId),
          inArray(controlExceptions.status, ["requested", "approved"]),
        ),
      );
    if (active.length > 0) {
      throw new ValidationError(
        `control ${ec.controlId} already has an active exception (${active[0]!.status})`,
      );
    }

    const initiativeId = await initiativeIdForEffectiveControl(tx, ec.deploymentId);
    const id = `exc-${randomUUID()}`;
    await tx.insert(controlExceptions).values({
      id,
      effectiveControlId,
      controlId: ec.controlId,
      initiativeId,
      status: "requested",
      reason,
      requestedBy: actor.id,
      requestedAt: new Date(nowTs()),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      expiresAt: null,
      supersedesId: null,
      createdAt: new Date(nowTs()),
    });
    await tx
      .update(effectiveControls)
      .set({ status: "exception_requested" })
      .where(eq(effectiveControls.id, effectiveControlId));
    await audit(
      tx,
      initiativeId,
      actor,
      "control_exception_requested",
      `Requested exception for ${ec.controlId}: ${reason}`,
      ec.status,
      "exception_requested",
      { exceptionId: id, controlId: ec.controlId },
    );
    return { id, controlId: ec.controlId, status: "requested", expiresAt: null };
  });
}

/**
 * Approve or reject a requested exception. Approver/admin only, and never the
 * requester (SoD). Approving sets an expiry (default 90 days); rejecting
 * returns the effective control to `overdue`.
 */
export async function decideException(
  db: Db,
  exceptionId: string,
  actor: Actor,
  approve: boolean,
  decisionReason: string,
  expiresAt?: number,
): Promise<ExceptionResult> {
  requireDecider(actor);
  if (!decisionReason || decisionReason.trim().length === 0) {
    throw new ValidationError("exception decision requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [exc] = await tx.select().from(controlExceptions).where(eq(controlExceptions.id, exceptionId));
    if (!exc) throw new NotFoundError("controlException", exceptionId);
    if (exc.status !== "requested") {
      throw new ValidationError(`exception ${exceptionId} is '${exc.status}', not 'requested'`);
    }
    if (exc.requestedBy === actor.id) {
      throw new IllegalTransitionError(
        `separation of duties: '${actor.id}' cannot decide an exception they requested`,
        "in_review",
        "start_review",
        actor.role,
      );
    }

    const newStatus: ExceptionStatus = approve ? "approved" : "rejected";
    const grantedExpiry = approve ? (expiresAt ?? nowTs() + DEFAULT_EXCEPTION_DAYS * DAY_MS) : null;
    await tx
      .update(controlExceptions)
      .set({
        status: newStatus,
        decidedBy: actor.id,
        decidedAt: new Date(nowTs()),
        decisionReason,
        expiresAt: grantedExpiry,
      })
      .where(eq(controlExceptions.id, exceptionId));

    // Approved -> control stays under active exception; rejected -> overdue.
    if (!approve) {
      await tx
        .update(effectiveControls)
        .set({ status: "overdue" })
        .where(eq(effectiveControls.id, exc.effectiveControlId));
    }
    await audit(
      tx,
      exc.initiativeId,
      actor,
      approve ? "control_exception_approved" : "control_exception_rejected",
      `${approve ? "Approved" : "Rejected"} exception for ${exc.controlId}: ${decisionReason}`,
      "requested",
      newStatus,
      { exceptionId, controlId: exc.controlId },
    );
    return { id: exceptionId, controlId: exc.controlId, status: newStatus, expiresAt: grantedExpiry };
  });
}

/** Revoke an approved exception early. Approver/admin only. Returns the control to `overdue`. */
export async function revokeException(
  db: Db,
  exceptionId: string,
  actor: Actor,
  reason: string,
): Promise<ExceptionResult> {
  requireDecider(actor);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception revoke requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [exc] = await tx.select().from(controlExceptions).where(eq(controlExceptions.id, exceptionId));
    if (!exc) throw new NotFoundError("controlException", exceptionId);
    if (exc.status !== "approved") {
      throw new ValidationError(`only an approved exception can be revoked; ${exceptionId} is '${exc.status}'`);
    }
    await tx
      .update(controlExceptions)
      .set({ status: "revoked", decidedBy: actor.id, decidedAt: new Date(nowTs()), decisionReason: reason })
      .where(eq(controlExceptions.id, exceptionId));
    await tx
      .update(effectiveControls)
      .set({ status: "overdue" })
      .where(eq(effectiveControls.id, exc.effectiveControlId));
    await audit(
      tx,
      exc.initiativeId,
      actor,
      "control_exception_revoked",
      `Revoked exception for ${exc.controlId}: ${reason}`,
      "approved",
      "revoked",
      { exceptionId, controlId: exc.controlId },
    );
    return { id: exceptionId, controlId: exc.controlId, status: "revoked", expiresAt: null };
  });
}

/**
 * Renew an approved (typically near-expiry) exception: opens a NEW `requested`
 * exception that supersedes it, to be approved through `decideException`. The
 * old exception is left as-is until the new one is approved. Any authenticated
 * actor may renew (route-gated).
 */
export async function renewException(
  db: Db,
  exceptionId: string,
  actor: Actor,
  reason: string,
): Promise<ExceptionResult> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception renewal requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [exc] = await tx.select().from(controlExceptions).where(eq(controlExceptions.id, exceptionId));
    if (!exc) throw new NotFoundError("controlException", exceptionId);
    if (exc.status !== "approved") {
      throw new ValidationError(`only an approved exception can be renewed; ${exceptionId} is '${exc.status}'`);
    }
    const id = `exc-${randomUUID()}`;
    await tx.insert(controlExceptions).values({
      id,
      effectiveControlId: exc.effectiveControlId,
      controlId: exc.controlId,
      initiativeId: exc.initiativeId,
      status: "requested",
      reason,
      requestedBy: actor.id,
      requestedAt: new Date(nowTs()),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      expiresAt: null,
      supersedesId: exceptionId,
      createdAt: new Date(nowTs()),
    });
    await audit(
      tx,
      exc.initiativeId,
      actor,
      "control_exception_renewed",
      `Renewal requested for ${exc.controlId} (supersedes ${exceptionId}): ${reason}`,
      "approved",
      "requested",
      { exceptionId: id, supersedesId: exceptionId, controlId: exc.controlId },
    );
    return { id, controlId: exc.controlId, status: "requested", expiresAt: null };
  });
}

/**
 * Auto-expire any approved exception past its `expiresAt` deadline. Returns
 * the ids expired. Idempotent — a second call at the same `nowMs` finds none.
 * Intended to run from the scheduled monitor / a cron. System-driven, no actor
 * role check.
 */
export async function expireDueExceptions(
  db: Db,
  nowMs: number,
  actor: Actor = { id: "system", role: "system" },
): Promise<string[]> {
  const due = await db
    .select()
    .from(controlExceptions)
    .where(and(eq(controlExceptions.status, "approved"), lte(controlExceptions.expiresAt, nowMs)));
  const expired: string[] = [];
  for (const exc of due) {
    await db.transaction(async (tx) => {
      await tx
        .update(controlExceptions)
        .set({ status: "expired" })
        .where(eq(controlExceptions.id, exc.id));
      await tx
        .update(effectiveControls)
        .set({ status: "overdue" })
        .where(eq(effectiveControls.id, exc.effectiveControlId));
      await audit(
        tx,
        exc.initiativeId,
        actor,
        "control_exception_expired",
        `Exception for ${exc.controlId} expired at ${new Date(nowMs).toISOString()}.`,
        "approved",
        "expired",
        { exceptionId: exc.id, controlId: exc.controlId },
      );
    });
    expired.push(exc.id);
  }
  return expired;
}

export interface ExceptionRow {
  id: string;
  controlId: string;
  effectiveControlId: string;
  initiativeId: string | null;
  status: ExceptionStatus;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  expiresAt: number | null;
  supersedesId: string | null;
}

/** List exceptions, optionally filtered by status. Public read model support. */
export async function listExceptions(db: Db, status?: ExceptionStatus): Promise<ExceptionRow[]> {
  const rows = status
    ? await db.select().from(controlExceptions).where(eq(controlExceptions.status, status))
    : await db.select().from(controlExceptions);
  return rows
    .slice()
    .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
    .map((r) => ({
      id: r.id,
      controlId: r.controlId,
      effectiveControlId: r.effectiveControlId,
      initiativeId: r.initiativeId,
      status: r.status as ExceptionStatus,
      reason: r.reason,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt.toISOString(),
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionReason: r.decisionReason,
      expiresAt: r.expiresAt,
      supersedesId: r.supersedesId,
    }));
}
