// Database errors from drizzle embed the statement AND its bound parameters in
// their message ("Failed query: ...\nparams: ..."), which Next then writes to
// the log: session tokens and intake text would leak. Rethrow this instead.
interface PgErrorFields {
  code?: unknown;
  constraint?: unknown;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_REASON_CHARS = 200;

/**
 * Sanitized copy of a failed-query error: SQLSTATE and constraint only, never
 * the statement, its parameters or the driver's `detail`. A driver error with
 * no SQLSTATE (a refused connection, say) never reached statement execution,
 * so its own message cannot quote bound parameters and is kept as the reason.
 */
export function redactDbError(err: unknown): Error {
  const e = err as { query?: unknown; params?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== "object" || !("query" in e) || !("params" in e)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const driver = (e.cause ?? e) as PgErrorFields;
  const rawCode = typeof driver.code === "string" ? driver.code : undefined;
  const sqlState = rawCode !== undefined && SQLSTATE.test(rawCode);
  const constraint = sqlState && typeof driver.constraint === "string" ? driver.constraint : undefined;
  let message = "Database query failed";
  if (sqlState) {
    message += ` (SQLSTATE ${rawCode}${constraint ? `, constraint ${constraint}` : ""})`;
  } else if (e.cause instanceof Error && !("query" in e.cause) && !("params" in e.cause)) {
    const reason = e.cause.message.replace(/\s*[\r\n]+\s*/g, " ").slice(0, MAX_REASON_CHARS);
    if (reason) message += `: ${reason}`;
  }
  const out = new Error(message) as Error & PgErrorFields & { cause?: PgErrorFields };
  out.code = rawCode;
  out.constraint = constraint;
  out.cause = { code: rawCode, constraint };
  return out;
}
