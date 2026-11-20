import { and, eq, getTableColumns, gt, isNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { controlExceptions, effectiveControls } from "../db/schema";

type Reader = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * An 'approved' exception whose date has passed. Production has no cron to
 * write the 'expired' status, so every read treats such a row as expired
 * instead (nothing is written on read).
 */
export function isLapsedApproval(row: { status: string; expiresAt: number | null }, nowMs: number): boolean {
  return row.status === "approved" && row.expiresAt !== null && row.expiresAt <= nowMs;
}

/**
 * An exception is active when it is requested, or approved and not yet past
 * its date. An approved row past its date counts as expired even before the
 * sweep has written that status (production has no cron). Anything that keeps
 * or writes a control's status from its exceptions uses this one definition.
 */
export function activeExceptionCondition(nowMs: number) {
  return or(
    eq(controlExceptions.status, "requested"),
    and(
      eq(controlExceptions.status, "approved"),
      or(isNull(controlExceptions.expiresAt), gt(controlExceptions.expiresAt, nowMs)),
    ),
  )!;
}

/**
 * All effective controls, with the status of a control that is
 * 'exception_requested' only because of an approval that has since lapsed
 * replaced by the status it had when the exception was requested (what the
 * sweep would restore). Controls with a live request or approval keep their
 * stored status. One query, so the read model's query budget is unchanged.
 */
export function selectEffectiveControlsWithLapsedResolved(db: Reader, nowMs: number) {
  const live = sql`exists (select 1 from control_exceptions ce where ce.effective_control_id = ${effectiveControls.id}
    and (ce.status = 'requested' or (ce.status = 'approved' and (ce.expires_at is null or ce.expires_at > ${nowMs}))))`;
  const lapsedRestore = sql`(select coalesce(ce.status_at_request, 'overdue') from control_exceptions ce
    where ce.effective_control_id = ${effectiveControls.id} and ce.status = 'approved' and ce.expires_at <= ${nowMs}
    order by ce.expires_at desc limit 1)`;
  const status = sql<string>`case when ${effectiveControls.status} = 'exception_requested' and not ${live}
    then coalesce(${lapsedRestore}, ${effectiveControls.status}) else ${effectiveControls.status} end`;
  return db.select({ ...getTableColumns(effectiveControls), status }).from(effectiveControls);
}
