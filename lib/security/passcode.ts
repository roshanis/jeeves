import { timingSafeEqual } from "node:crypto";

/**
 * Result of a passcode verification attempt. Never carries the passcode
 * value itself — callers must not log this object's inputs, only this
 * typed result.
 */
export type PasscodeVerificationResult =
  | { ok: true }
  | { ok: false; reason: "mismatch" | "misconfigured" };

/**
 * Verify a provided passcode against the expected (server-configured)
 * passcode using a constant-time comparison, so response timing cannot be
 * used to brute-force the passcode character-by-character (plan §3 / AGENTS.md
 * hard rule 2 — passcode-gated live demo).
 *
 * - `node:crypto`'s `timingSafeEqual` requires equal-length buffers, so we
 *   normalize length first: if lengths differ we still perform a
 *   constant-time comparison against a same-length dummy buffer (so the
 *   function's *shape* of work doesn't leak the correct length via an
 *   early return) before reporting `mismatch`.
 * - Never logs `provided` or `expected` — callers must not either. This
 *   function does not call console.* at all.
 * - An empty `expected` means the passcode was never configured
 *   server-side; that is a misconfiguration, not a valid "empty passcode"
 *   state, so it is reported distinctly and always denies access.
 */
export function verifyPasscode(provided: string, expected: string): PasscodeVerificationResult {
  if (expected.length === 0) {
    return { ok: false, reason: "misconfigured" };
  }

  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");

  // timingSafeEqual throws if buffer lengths differ, so pad/truncate the
  // comparison buffer to expected's length. This still performs a full
  // constant-time comparison (rather than short-circuiting on length) so
  // that timing does not reveal how close `provided`'s length is to the
  // correct length.
  const normalizedProvided = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(normalizedProvided, 0, 0, Math.min(providedBuf.length, expectedBuf.length));

  const lengthsMatch = providedBuf.length === expectedBuf.length;
  const contentsMatch = timingSafeEqual(normalizedProvided, expectedBuf);

  if (lengthsMatch && contentsMatch) {
    return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}
