// Database errors from drizzle embed the statement AND its bound parameters in
// their message ("Failed query: ...\nparams: ..."), which Next then writes to
// the log: session tokens and intake text would leak. Rethrow this instead.
interface PgErrorFields {
  code?: unknown;
  constraint?: unknown;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_REASON_CHARS = 200;
const MAX_STATEMENT_CHARS = 120;

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
  const out = new Error(message) as Error & PgErrorFields & { cause?: PgErrorFields; statement?: string };
  out.code = rawCode;
  out.constraint = constraint;
  out.cause = { code: rawCode, constraint };
  // The statement holds placeholders only (no sql.raw in the sources): it names the table and operation for the operator.
  if (typeof e.query === "string") out.statement = e.query.replace(/\s+/g, " ").trim().slice(0, MAX_STATEMENT_CHARS);
  return out;
}

const WRAPPED = Symbol.for("jeeves.db.transactionRedacted");

/**
 * Makes `db.transaction` on this instance rethrow failed-statement errors
 * through redactDbError, so a route or page that lets one escape never logs
 * the bound parameters. Other rejections pass through as the same object.
 * Statements run outside a transaction are not covered. Idempotent.
 */
export function redactTransactionErrors<T extends { transaction: (...args: never[]) => Promise<unknown> }>(db: T): T {
  const target = db as T & { [WRAPPED]?: true };
  if (target[WRAPPED]) return db;
  const original = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  (db as { transaction: unknown }).transaction = async (...args: unknown[]) => {
    try {
      return await original(...args);
    } catch (err) {
      const e = err as { query?: unknown; params?: unknown } | null;
      if (e && typeof e === "object" && "query" in e && "params" in e) throw redactDbError(err);
      throw err;
    }
  };
  target[WRAPPED] = true;
  return db;
}
