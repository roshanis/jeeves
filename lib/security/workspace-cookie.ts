import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed `jeeves_workspace` cookie (security-hardening pass, external-review
 * finding #1 continuation: `issueDemoSession` used to blindly trust the
 * caller-supplied `jeeves_workspace` cookie as the workspace to bind a new
 * session to — an attacker could set that cookie to ANY workspace id,
 * causing every downstream workspace-authorization check (lib/services/
 * workspace-guard.ts) to trivially pass for a workspace they don't own).
 *
 * The cookie is a read-scoping/session-continuity convenience, not a
 * capability token by itself — but since a session's `workspaceId` now
 * gates MUTATIONS (via the workspace-authorization checks added alongside
 * this module), the cookie must be tamper-evident. Format: `"<id>.<hex
 * hmac-sha256>"`. Mirrors lib/security/passcode.ts's constant-time-compare
 * style.
 */

/** Safe shape for a workspace id. Real ids are `ws_` + 64 hex chars (67
 * chars total, see lib/security/session.ts#deriveWorkspaceId) — bounded
 * generously above that so a format change doesn't require touching this
 * file. */
const WORKSPACE_ID_FORMAT = /^[A-Za-z0-9_-]{8,80}$/;

/** Sign `id` with `secret`, producing the full cookie value. */
export function signWorkspaceId(id: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(id).digest("hex");
  return `${id}.${mac}`;
}

/**
 * Verify a `jeeves_workspace` cookie value against `secret`, returning the
 * embedded workspace id on success or `null` on ANY failure (missing
 * secret, missing/empty value, no signature present — e.g. a legacy
 * pre-hardening cookie or someone manually setting the cookie, malformed id
 * shape, or a mac mismatch). Callers must treat `null` as "no existing
 * workspace" (issue a fresh one) — never fall back to trusting the raw
 * value.
 *
 * `secret === null` (no `JEEVES_COOKIE_SECRET` and no derivable
 * `DEMO_PASSCODE`) always returns `null`: with no secret there is no way to
 * verify a signature, so the safe behavior is to never reuse — not to trust
 * the cookie unsigned.
 */
export function verifyWorkspaceCookie(
  value: string | null | undefined,
  secret: string | null,
): string | null {
  if (!secret || !value) return null;

  const sepIndex = value.lastIndexOf(".");
  if (sepIndex <= 0 || sepIndex === value.length - 1) return null; // no id or no mac

  const id = value.slice(0, sepIndex);
  const providedMac = value.slice(sepIndex + 1);
  if (!WORKSPACE_ID_FORMAT.test(id)) return null;

  const expectedMac = createHmac("sha256", secret).update(id).digest("hex");

  // Constant-time compare, length-normalized first (timingSafeEqual requires
  // equal-length buffers) — mirrors lib/security/passcode.ts#verifyPasscode.
  const expectedBuf = Buffer.from(expectedMac, "utf8");
  const providedBuf = Buffer.from(providedMac, "utf8");
  const normalizedProvided = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(normalizedProvided, 0, 0, Math.min(providedBuf.length, expectedBuf.length));
  const lengthsMatch = providedBuf.length === expectedBuf.length;
  const contentsMatch = timingSafeEqual(normalizedProvided, expectedBuf);

  return lengthsMatch && contentsMatch ? id : null;
}

/**
 * Resolve the secret used to sign/verify the workspace cookie:
 *   1. `JEEVES_COOKIE_SECRET` env var, if set and non-empty.
 *   2. Otherwise, a secret DERIVED from `DEMO_PASSCODE` (domain-separated —
 *      never sign the workspace cookie with the raw passcode bytes; a leak
 *      of one secret should not automatically leak the other even though
 *      they currently share a root env var).
 *   3. Otherwise `null` — no secret is available; callers must never sign
 *      or trust a workspace cookie in this case (fresh workspace every
 *      time; see `verifyWorkspaceCookie`).
 */
export function resolveWorkspaceCookieSecret(): string | null {
  const explicit = process.env.JEEVES_COOKIE_SECRET;
  if (explicit && explicit.length > 0) return explicit;

  const passcode = process.env.DEMO_PASSCODE;
  if (passcode && passcode.length > 0) {
    return createHash("sha256").update(`jeeves-workspace-cookie:${passcode}`).digest("hex");
  }

  return null;
}
