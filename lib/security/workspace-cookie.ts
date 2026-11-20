import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed `jeeves_workspace` cookie. It is a bearer capability for ONE
 * playground workspace: whoever holds a valid value can enter that workspace
 * under any persona (POST /api/session) and read it on server-rendered pages.
 * It is bounded by its issue time (`WORKSPACE_COOKIE_MAX_AGE_SECONDS`, the
 * same as the browser cookie's Max-Age) so a copied value stops working on
 * its own; rotating the secret still drops every visitor's workspace at once.
 * It must be tamper-evident because a session's `workspaceId` gates mutations
 * (lib/services/workspace-guard.ts).
 *
 * Format: `v1.<issued-at, unix seconds>.<id>.<hex hmac-sha256 of the first
 * three parts>`. Values without the version and issue time (the earlier
 * `<id>.<mac>` format) are refused, so visitors holding one start a fresh
 * workspace once.
 */

/** Lifetime of the cookie, enforced both by the browser (Max-Age) and by verification. */
export const WORKSPACE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Tolerated clock difference between the instance that signed and the one that verifies. */
const FUTURE_SKEW_MS = 60_000;

const VERSION = "v1";

/** Safe shape for a workspace id. Real ids are `ws_` + 64 hex chars (67
 * chars total, see lib/security/session.ts#generateWorkspaceId) — bounded
 * generously above that so a format change doesn't require touching this
 * file. No dots, so the dot-separated value parses unambiguously. */
const WORKSPACE_ID_FORMAT = /^[A-Za-z0-9_-]{8,80}$/;

function macFor(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Sign `id` with `secret`, producing the full cookie value. `now` is for tests. */
export function signWorkspaceId(id: string, secret: string, now: number = Date.now()): string {
  const payload = `${VERSION}.${Math.floor(now / 1000)}.${id}`;
  return `${payload}.${macFor(payload, secret)}`;
}

/**
 * Verify a `jeeves_workspace` cookie value against `secret`, returning the
 * embedded workspace id on success or `null` on ANY failure (missing
 * secret, missing/empty value, wrong version or an old-format value, a
 * malformed id shape, a mac mismatch, an issue time in the future beyond a
 * small skew, or one older than the cookie's Max-Age). Callers must treat
 * `null` as "no existing workspace" (issue a fresh one) — never fall back to
 * trusting the raw value.
 *
 * `secret === null` (no `JEEVES_COOKIE_SECRET` and no derivable
 * `DEMO_PASSCODE`) always returns `null`: with no secret there is no way to
 * verify a signature, so the safe behavior is to never reuse — not to trust
 * the cookie unsigned.
 */
export function verifyWorkspaceCookie(
  value: string | null | undefined,
  secret: string | null,
  now: number = Date.now(),
): string | null {
  if (!secret || !value) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null; // old `<id>.<mac>` format or garbage
  const [version, issuedRaw, id, providedMac] = parts;
  if (version !== VERSION || !/^\d{1,12}$/.test(issuedRaw)) return null;
  if (!WORKSPACE_ID_FORMAT.test(id)) return null;

  const expectedBuf = Buffer.from(macFor(`${version}.${issuedRaw}.${id}`, secret), "utf8");
  const providedBuf = Buffer.from(providedMac, "utf8");
  // Constant-time compare, length-normalized first (timingSafeEqual requires
  // equal-length buffers).
  const normalizedProvided = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(normalizedProvided, 0, 0, Math.min(providedBuf.length, expectedBuf.length));
  const lengthsMatch = providedBuf.length === expectedBuf.length;
  const contentsMatch = timingSafeEqual(normalizedProvided, expectedBuf);
  if (!(lengthsMatch && contentsMatch)) return null;

  const issuedMs = Number(issuedRaw) * 1000;
  if (issuedMs > now + FUTURE_SKEW_MS) return null;
  if (now - issuedMs > WORKSPACE_COOKIE_MAX_AGE_SECONDS * 1000) return null;
  return id;
}

/**
 * Resolve the secret used to sign/verify the workspace cookie:
 *   1. `JEEVES_COOKIE_SECRET` env var, if set and non-empty.
 *   2. Legacy compatibility only: a signing secret DERIVED from `DEMO_PASSCODE` (domain-separated —
 *      never sign the workspace cookie with the raw passcode bytes; a leak
 *      of one secret should not automatically leak the other even though
 *      they currently share a root env var).
 *   3. Otherwise `null` — no secret is available; callers must never sign
 *      or trust a workspace cookie in this case (fresh workspace every
 *      time; see `verifyWorkspaceCookie`).
 */
// DEMO_PASSCODE is never checked during entry. Until operators configure
// JEEVES_COOKIE_SECRET, this deprecated fallback signs new cookies and verifies
// existing ones using the same deployment signing material.
export function resolveWorkspaceCookieSecret(): string | null {
  const explicit = process.env.JEEVES_COOKIE_SECRET;
  if (explicit && explicit.length > 0) return explicit;

  const passcode = process.env.DEMO_PASSCODE;
  if (passcode && passcode.length > 0) {
    return createHash("sha256").update(`jeeves-workspace-cookie:${passcode}`).digest("hex");
  }

  return null;
}
