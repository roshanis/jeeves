/**
 * Driver error codes that are safe to log and to name in an operator-facing
 * line: they carry no host, user or password. Anything else prints nothing.
 */
export const SAFE_DRIVER_CODES = new Set([
  "EROFS", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
  "ECONNABORTED", "EPIPE", "08000", "08001", "08003", "08004", "08006", "08007", "53300", "57P01", "57P02",
  "42P01", "42703", "28P01", "28000", "42501", "3D000",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN", "CERT_REJECTED",
]);

/**
 * The first allow-listed driver code found on the error or down its cause
 * chain (Drizzle wraps the driver error in `.cause`; AggregateError keeps
 * its members in `.errors`), or undefined. Outermost first, bounded depth.
 */
export function safeDriverCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 5) return undefined;
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string" && SAFE_DRIVER_CODES.has(code)) return code;
  for (const next of [cause, ...(Array.isArray(errors) ? errors : [])]) {
    const found = safeDriverCode(next, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Codes that are an ANSWER from a reachable server or TLS peer, never an outage. */
export const ANSWER_DRIVER_CODES = new Set(["28P01", "28000", "3D000", "42501", "42P01", "42703"]);
const TLS_CODE = /^(CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/;

/** Errno and SQLSTATE codes of a database that cannot be reached right now. */
export const CONNECTION_DRIVER_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
  "ECONNABORTED", "EPIPE",
  "08000", "08001", "08003", "08004", "08006", "08007", "57P01", "57P02", "57P03", "53300",
]);

/** A per-attempt deadline of the demo boot check passed: the database did not answer in time. */
export class BootDeadlineError extends Error {
  constructor(ms: number) {
    super(`no answer from the database within ${ms} ms`);
    this.name = "BootDeadlineError";
  }
}

function chain(error: unknown, depth = 0): object[] {
  if (!error || typeof error !== "object" || depth > 5) return [];
  const { cause, errors } = error as { cause?: unknown; errors?: unknown };
  return [error, ...[cause, ...(Array.isArray(errors) ? errors : [])].flatMap((next) => chain(next, depth + 1))];
}

/**
 * True when the error says the database cannot be reached (refused, timed out,
 * suspended, out of quota), false for everything else. An ANSWER anywhere in
 * the cause chain (bad credentials, missing database, a TLS verdict, an
 * installation-check verdict) wins over any wording that looks like an outage:
 * those must keep failing at once.
 */
export function isConnectionClassError(error: unknown): boolean {
  const nodes = chain(error);
  if (nodes.length === 0) return false;
  const meta = nodes.map((n) => {
    const { code, name, message } = n as { code?: unknown; name?: unknown; message?: unknown };
    return { code: typeof code === "string" ? code : "", name: typeof name === "string" ? name : "", message: typeof message === "string" ? message : "" };
  });
  if (meta.some((m) => m.name === "InstallationCheckError" || ANSWER_DRIVER_CODES.has(m.code) || TLS_CODE.test(m.code))) return false;
  return meta.some(
    (m) =>
      m.name === "BootDeadlineError" ||
      CONNECTION_DRIVER_CODES.has(m.code) ||
      /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/.test(m.message) ||
      /timeout exceeded when trying to connect/i.test(m.message) ||
      /Connection terminated/i.test(m.message) ||
      (m.code === "XX000" && /quota|disabled|suspended/i.test(m.message)),
  );
}
