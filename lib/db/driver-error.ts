/**
 * Driver error codes that are safe to log and to name in an operator-facing
 * line: they carry no host, user or password. Anything else prints nothing.
 */
export const SAFE_DRIVER_CODES = new Set([
  "EROFS", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
  "08000", "08003", "08006", "53300", "57P01",
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
