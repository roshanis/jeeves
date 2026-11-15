// Database errors from drizzle embed the statement AND its bound parameters in
// their message ("Failed query: ...\nparams: ..."), which Next then writes to
// the log: session tokens and intake text would leak. Rethrow this instead.
interface PgErrorFields {
  code?: unknown;
  constraint?: unknown;
}

/** Sanitized copy of a failed-query error: SQLSTATE and constraint only, never the statement parameters or the driver's `detail`. */
export function redactDbError(err: unknown): Error {
  const e = err as { query?: unknown; params?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== "object" || !("query" in e) || !("params" in e)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const driver = (e.cause ?? e) as PgErrorFields;
  const code = typeof driver.code === "string" ? driver.code : undefined;
  const constraint = typeof driver.constraint === "string" ? driver.constraint : undefined;
  const out = new Error(
    `Database query failed${code ? ` (SQLSTATE ${code}${constraint ? `, constraint ${constraint}` : ""})` : ""}`,
  ) as Error & PgErrorFields & { cause?: PgErrorFields };
  out.code = code;
  out.constraint = constraint;
  out.cause = { code, constraint };
  return out;
}
