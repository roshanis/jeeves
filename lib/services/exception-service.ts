/**
 * Control-exception workflow (plan.md M4): a control that cannot currently be
 * met may run under a time-boxed, accountable EXCEPTION.
 *
 * Lifecycle:  request -> approve | reject
 *             approved -> revoke | renew | (auto) expire
 *             renewal decided approve -> atomically supersedes the original
 *               (approved -> superseded); renewal decided reject/original
 *               revoked/expired first -> original's terminal state stands,
 *               supersession is skipped (best-effort, never fails the
 *               renewal's own decision)
 *
 * Separation of duties: anyone with a stake may REQUEST; only an approver or
 * admin may DECIDE / REVOKE, and never on an exception they requested
 * themselves. Every transition is written atomically with an `audit_events`
 * row (append-only at the DB level, migration 0002).
 *
 * The linked `effective_controls.status` is DERIVED (`recomputeControlStatus`
 * below) from ALL of the control's `control_exceptions` rows, not written
 * unconditionally per transition (external-review finding #5: a renewal in
 * flight left a control with TWO active exceptions — the still-approved
 * original and a new 'requested' renewal — and rejecting/expiring either one
 * unconditionally forced the control to 'overdue' even though the other was
 * still active). It moves to `exception_requested` whenever ANY exception for
 * the control is 'requested' or 'approved', and back to `overdue` otherwise.
 * The precise exception state (requested vs granted vs expired vs superseded,
 * expiry, who decided) lives on the `control_exceptions` row — the
 * effective-control status stays within its existing enum so the read model /
 * controls UI need no change.
 *
 * Active-exception uniqueness (at most one 'requested' and one 'approved' row
 * per control) is enforced at the DB level by two partial unique indexes
 * (migration 0007) as a backstop to the app-layer check in
 * `requestException`/`renewException`.
 *
 * Review finding P2-8 (status-integrity bug): `requestException` now gates
 * on the target control's status (`ELIGIBLE_EXCEPTION_REQUEST_STATUSES` —
 * 'overdue' or 'breached' only), and every exception row records the
 * control's status at request time (`statusAtRequest`, migration 0008). A
 * terminal transition (reject/revoke/expire, or renewal-supersession) that
 * leaves a control with no remaining active exception restores that recorded
 * status instead of `recomputeControlStatus` unconditionally forcing
 * 'overdue' — which previously lost the control's real prior status,
 * recoverable only by reading audit rows.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { auditEvents, controlExceptions, deploymentVersions, effectiveControls, initiatives } from "../db/schema";
import type { Actor } from "../domain/types";
import { ConflictError, NotFoundError, ValidationError, IllegalTransitionError } from "./initiative-service";
import { workspaceMismatch } from "./workspace-guard";

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Default validity window for an approved exception when none is supplied. */
const DEFAULT_EXCEPTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Review finding P2-8 (status-integrity bug): `requestException` had no
 * precondition on the target control's status, so an exception could be
 * requested against an already-healthy ('met') or not-yet-due ('pending')
 * control. Combined with `recomputeControlStatus` forcing 'overdue' once no
 * active exceptions remain, request-then-reject (or revoke/expire of the
 * last active exception) against such a control silently corrupted its
 * status. An exception only makes sense against a control that currently
 * cannot be met: 'overdue' (evidence lapsed) or 'breached' (evidence failed
 * a threshold) — not 'met' (already satisfied) or 'pending' (not yet due).
 * 'exception_requested' is deliberately excluded too: that status only ever
 * reflects an exception already active for the control, which the
 * active-exception check below independently rejects.
 */
const ELIGIBLE_EXCEPTION_REQUEST_STATUSES: ReadonlySet<string> = new Set(["overdue", "breached"]);

export type ExceptionStatus = "requested" | "approved" | "rejected" | "revoked" | "expired" | "superseded";

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

/**
 * Resolve an initiative id (possibly null — e.g. an orphaned effective
 * control) to its workspaceId. An unresolvable initiativeId is treated as
 * shared/null-workspace (defensive: never accidentally hides a row this
 * module can't attribute to a workspace).
 */
async function initiativeWorkspaceId(tx: Tx, initiativeId: string | null): Promise<string | null> {
  if (!initiativeId) return null;
  const [row] = await tx
    .select({ workspaceId: initiatives.workspaceId })
    .from(initiatives)
    .where(eq(initiatives.id, initiativeId));
  return row?.workspaceId ?? null;
}

/**
 * Workspace-authorization guard (external-review finding #1, extended to
 * control exceptions): resolves the exception's owning initiative via
 * effectiveControl -> deployment -> initiative (or directly from a
 * `control_exceptions.initiativeId` already on hand) and throws the SAME
 * `NotFoundError` shape used for an unknown id on mismatch — an exception
 * whose resolved initiative is NULL-workspace is shared/mutable by any
 * session, matching `initiatives.workspaceId`'s semantics.
 */
async function assertExceptionWorkspaceAccess(
  tx: Tx,
  initiativeId: string | null,
  sessionWorkspaceId: string | null,
  entity: string,
  id: string,
): Promise<void> {
  const resourceWorkspaceId = await initiativeWorkspaceId(tx, initiativeId);
  if (workspaceMismatch(resourceWorkspaceId, sessionWorkspaceId)) {
    throw new NotFoundError(entity, id);
  }
}

/**
 * Batch-resolve `workspaceId` for a set of initiative ids — used by
 * `listExceptions`'s viewer-scoping filter (external-review finding #2
 * spillover). A single query rather than the per-row, transaction-scoped
 * `initiativeWorkspaceId` helper above (that one is typed to `Tx` for the
 * single-row mutation guards; this one runs a plain read, possibly outside
 * any transaction).
 */
async function initiativeWorkspaceIds(db: Db, initiativeIds: string[]): Promise<Map<string, string | null>> {
  if (initiativeIds.length === 0) return new Map();
  const rows = await db
    .select({ id: initiatives.id, workspaceId: initiatives.workspaceId })
    .from(initiatives)
    .where(inArray(initiatives.id, initiativeIds));
  return new Map(rows.map((r) => [r.id, r.workspaceId]));
}

/**
 * Derive `effective_controls.status` from ALL of a control's
 * `control_exceptions` rows and write it — the fix for external-review
 * finding #5 ("Renewal leaves the original exception approved while opening
 * a second requested exception. Rejecting the renewal or later expiring the
 * old exception unconditionally marks the control overdue, even if another
 * approved exception exists."). Any 'requested' or 'approved' exception for
 * the control keeps it under `exception_requested`. Call this — instead of
 * writing `effectiveControls.status` directly — after every exception-state
 * transition that could change which exceptions are active for a control.
 *
 * Review finding P2-8 (status-integrity bug): when NO active exception
 * remains, this used to unconditionally force 'overdue' — losing whatever
 * status the control actually had before the (now-terminated) exception was
 * requested (e.g. 'breached', or, pre the `requestException` status gate
 * above, 'met'/'pending'). `terminatedStatusAtRequest` — the terminated
 * exception's own `statusAtRequest` (migration 0008) — is restored instead.
 * Omit it (or pass a row with no recorded value — pre-migration rows) to
 * fall back to the historical 'overdue' behavior; callers that AREN'T
 * terminating the control's last active exception (e.g. `requestException`
 * inserting a new active row) can omit it freely since the "active exists"
 * branch is taken regardless.
 */
async function recomputeControlStatus(
  tx: Tx,
  effectiveControlId: string,
  terminatedStatusAtRequest?: string | null,
): Promise<void> {
  const active = await tx
    .select({ id: controlExceptions.id })
    .from(controlExceptions)
    .where(
      and(
        eq(controlExceptions.effectiveControlId, effectiveControlId),
        inArray(controlExceptions.status, ["requested", "approved"]),
      ),
    )
    .limit(1);
  const restoredStatus = terminatedStatusAtRequest ?? "overdue";
  await tx
    .update(effectiveControls)
    .set({ status: active.length > 0 ? "exception_requested" : restoredStatus })
    .where(eq(effectiveControls.id, effectiveControlId));
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
 * actor may request (route-gated by session). Requires the control to
 * currently be 'overdue' or 'breached' (review finding P2-8 — see
 * `ELIGIBLE_EXCEPTION_REQUEST_STATUSES`); rejects if the control already
 * has an active (requested/approved) exception. Moves the effective control
 * to `exception_requested`, recording its pre-request status on the new row
 * (`statusAtRequest`, migration 0008) so a later terminal transition can
 * restore it instead of hardcoding 'overdue'.
 */
export async function requestException(
  db: Db,
  effectiveControlId: string,
  actor: Actor,
  sessionWorkspaceId: string | null,
  reason: string,
): Promise<ExceptionResult> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception request requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [ec] = await tx.select().from(effectiveControls).where(eq(effectiveControls.id, effectiveControlId));
    if (!ec) throw new NotFoundError("effectiveControl", effectiveControlId);

    const initiativeIdForCheck = await initiativeIdForEffectiveControl(tx, ec.deploymentId);
    await assertExceptionWorkspaceAccess(
      tx,
      initiativeIdForCheck,
      sessionWorkspaceId,
      "effectiveControl",
      effectiveControlId,
    );

    if (!ELIGIBLE_EXCEPTION_REQUEST_STATUSES.has(ec.status)) {
      throw new ValidationError(
        `control ${ec.controlId} is '${ec.status}'; an exception may only be requested against a control that is 'overdue' or 'breached'`,
      );
    }

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

    const initiativeId = initiativeIdForCheck;
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
      statusAtRequest: ec.status,
      createdAt: new Date(nowTs()),
    });
    await recomputeControlStatus(tx, effectiveControlId);
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
  sessionWorkspaceId: string | null,
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
    await assertExceptionWorkspaceAccess(
      tx,
      exc.initiativeId,
      sessionWorkspaceId,
      "controlException",
      exceptionId,
    );
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

    // Atomic supersession (external-review finding #5): approving a renewal
    // (a row with `supersedesId`) retires the original it renews. This MUST
    // run BEFORE the renewal's own CAS update below — while the original is
    // still 'approved', setting the renewal to 'approved' first would
    // transiently give the control TWO 'approved' rows at once and trip the
    // "at most one approved exception per control" partial unique index
    // (migration 0007) mid-transaction. Best-effort by design: if the
    // original is no longer 'approved' (already revoked/expired), this CAS
    // simply affects 0 rows and the renewal's own decision still proceeds.
    let supersededOriginal = false;
    if (approve && exc.supersedesId) {
      const superseded = await tx
        .update(controlExceptions)
        .set({ status: "superseded" })
        .where(and(eq(controlExceptions.id, exc.supersedesId), eq(controlExceptions.status, "approved")))
        .returning();
      supersededOriginal = superseded.length > 0;
    }

    // Compare-and-set (external-review finding #5, mirroring finding #3's
    // pattern elsewhere): only write if the row is still 'requested' as of
    // this UPDATE, not just as of the SELECT above.
    const decided = await tx
      .update(controlExceptions)
      .set({
        status: newStatus,
        decidedBy: actor.id,
        decidedAt: new Date(nowTs()),
        decisionReason,
        expiresAt: grantedExpiry,
      })
      .where(and(eq(controlExceptions.id, exceptionId), eq(controlExceptions.status, "requested")))
      .returning();
    if (decided.length === 0) {
      throw new ConflictError(`exception ${exceptionId} changed concurrently (expected status 'requested')`);
    }

    if (supersededOriginal) {
      await audit(
        tx,
        exc.initiativeId,
        actor,
        "control_exception_superseded",
        `Exception ${exc.supersedesId} for ${exc.controlId} superseded by renewal ${exceptionId}.`,
        "approved",
        "superseded",
        { exceptionId: exc.supersedesId, supersededBy: exceptionId, controlId: exc.controlId },
      );
    }

    // Derive the control's status from ALL of its exceptions now that this
    // one (and, on approval of a renewal, the superseded original) has
    // moved — never a hardcoded overdue/exception_requested write. On
    // rejection this exception (`exc`) is the one being terminated, so its
    // `statusAtRequest` is the restore target if no other exception is
    // active (P2-8); on approval the row just written is itself active, so
    // the "active exists" branch is taken regardless of this argument.
    await recomputeControlStatus(tx, exc.effectiveControlId, exc.statusAtRequest);

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
  sessionWorkspaceId: string | null,
  reason: string,
): Promise<ExceptionResult> {
  requireDecider(actor);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception revoke requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [exc] = await tx.select().from(controlExceptions).where(eq(controlExceptions.id, exceptionId));
    if (!exc) throw new NotFoundError("controlException", exceptionId);
    await assertExceptionWorkspaceAccess(
      tx,
      exc.initiativeId,
      sessionWorkspaceId,
      "controlException",
      exceptionId,
    );
    if (exc.status !== "approved") {
      throw new ValidationError(`only an approved exception can be revoked; ${exceptionId} is '${exc.status}'`);
    }
    // Compare-and-set (external-review finding #5): only write if the row is
    // still 'approved' as of this UPDATE, not just as of the SELECT above.
    const revoked = await tx
      .update(controlExceptions)
      .set({ status: "revoked", decidedBy: actor.id, decidedAt: new Date(nowTs()), decisionReason: reason })
      .where(and(eq(controlExceptions.id, exceptionId), eq(controlExceptions.status, "approved")))
      .returning();
    if (revoked.length === 0) {
      throw new ConflictError(`exception ${exceptionId} changed concurrently (expected status 'approved')`);
    }
    // P2-8: restore to this (now-terminated) exception's statusAtRequest if
    // no other exception is left active, instead of hardcoding 'overdue'.
    await recomputeControlStatus(tx, exc.effectiveControlId, exc.statusAtRequest);
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
 * actor may renew (route-gated). The new row's `statusAtRequest` (P2-8)
 * PROPAGATES from the exception being renewed rather than reading the
 * control's current status (which is 'exception_requested' while the
 * original it renews is still active) — this way a chain of renewals keeps
 * pointing back to the control's real pre-exception status through however
 * many renewals occur, so an eventual terminal transition restores the true
 * origin status rather than the meaningless 'exception_requested'.
 */
export async function renewException(
  db: Db,
  exceptionId: string,
  actor: Actor,
  sessionWorkspaceId: string | null,
  reason: string,
): Promise<ExceptionResult> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("exception renewal requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const [exc] = await tx.select().from(controlExceptions).where(eq(controlExceptions.id, exceptionId));
    if (!exc) throw new NotFoundError("controlException", exceptionId);
    await assertExceptionWorkspaceAccess(
      tx,
      exc.initiativeId,
      sessionWorkspaceId,
      "controlException",
      exceptionId,
    );
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
      statusAtRequest: exc.statusAtRequest,
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
      // Compare-and-set (external-review finding #5): a system sweep, not a
      // user action — if another transaction already moved this row off
      // 'approved' since the SELECT above (revoked, or superseded by a
      // decided renewal), skip it silently rather than throwing.
      const updated = await tx
        .update(controlExceptions)
        .set({ status: "expired" })
        .where(and(eq(controlExceptions.id, exc.id), eq(controlExceptions.status, "approved")))
        .returning();
      if (updated.length === 0) return;

      // P2-8: restore to this (now-terminated) exception's statusAtRequest
      // if no other exception is left active, instead of hardcoding 'overdue'.
      await recomputeControlStatus(tx, exc.effectiveControlId, exc.statusAtRequest);
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
      expired.push(exc.id);
    });
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

export interface ListExceptionsOptions {
  /**
   * The resolved viewer's workspace (a valid session's workspaceId, else a
   * verified signed `jeeves_workspace` cookie, else null) — external-review
   * finding #2 spillover. An exception is visible when its `initiativeId` is
   * null, OR the owning initiative's `workspaceId` is null, OR it equals
   * this value. Pass `null` explicitly for an anonymous/no-session viewer;
   * OMIT `opts` entirely (not this field) for an unfiltered internal read.
   */
  viewerWorkspaceId?: string | null;
}

/**
 * List exceptions, optionally filtered by status. Public read model support.
 *
 * `opts` omitted -> unfiltered, for internal callers (e.g.
 * app/controls/page.tsx, which renders the full board for an already
 * workspace-agnostic view). Passing `opts` (even `{ viewerWorkspaceId: null
 * }`) scopes the result to what that viewer may see — this is what
 * `GET /api/exceptions` always does.
 */
export async function listExceptions(
  db: Db,
  status?: ExceptionStatus,
  opts?: ListExceptionsOptions,
): Promise<ExceptionRow[]> {
  const rows = status
    ? await db.select().from(controlExceptions).where(eq(controlExceptions.status, status))
    : await db.select().from(controlExceptions);

  let visibleRows = rows;
  if (opts) {
    const viewerWorkspaceId = opts.viewerWorkspaceId ?? null;
    const initiativeIds = Array.from(
      new Set(rows.map((r) => r.initiativeId).filter((id): id is string => id !== null)),
    );
    const workspaceIds = await initiativeWorkspaceIds(db, initiativeIds);
    visibleRows = rows.filter((r) => {
      if (!r.initiativeId) return true;
      const resourceWorkspaceId = workspaceIds.get(r.initiativeId) ?? null;
      return !workspaceMismatch(resourceWorkspaceId, viewerWorkspaceId);
    });
  }

  return visibleRows
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
