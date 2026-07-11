import { randomBytes } from "node:crypto";

/**
 * Demo-workspace session tokens (plan §3: "runs in an isolated demo
 * workspace (session-scoped data namespace, resettable)"). Pure logic —
 * no cookie/header wiring here; a Next.js route handler issues/reads the
 * token via whatever transport it chooses and calls into this module for
 * generation/validation/expiry and workspace-id derivation.
 */

export interface SessionConfig {
  /** Time-to-live in milliseconds from issuance. */
  ttlMs: number;
}

export interface Session {
  /** Opaque random session token (also used to derive the workspace id). */
  token: string;
  /** Epoch ms when this session was issued. */
  issuedAt: number;
  /** Epoch ms when this session stops being valid (exclusive). */
  expiresAt: number;
  /** Namespace id for this session's demo-workspace data isolation. */
  workspaceId: string;
}

export type SessionValidationResult = { valid: true } | { valid: false; reason: "expired" };

const TOKEN_BYTES = 32; // 256 bits of entropy, hex-encoded below.
const WORKSPACE_PREFIX = "ws_";

/**
 * Issue a new opaque session token via `node:crypto` randomness (not
 * `Math.random`), with an expiry computed from the injected clock (`now`)
 * plus `config.ttlMs`. No `Date.now()` is called directly so issuance is
 * deterministic and testable with a fake clock.
 */
export function issueSession(config: SessionConfig, now: () => number): Session {
  const issuedAt = now();
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return {
    token,
    issuedAt,
    expiresAt: issuedAt + config.ttlMs,
    workspaceId: deriveWorkspaceId(token),
  };
}

/**
 * Validate a session against the injected clock. Expiry is exclusive: a
 * session is no longer valid the instant `now() >= expiresAt`, so a caller
 * cannot squeeze in one more action exactly at the TTL boundary.
 */
export function validateSession(session: Session, now: () => number): SessionValidationResult {
  const nowMs = now();
  if (nowMs >= session.expiresAt) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

/**
 * Deterministically derive a workspace id (data-namespacing key) from a
 * session token. The token itself already carries enough entropy, so the
 * "derivation" here is a stable, URL/DB-key-safe transform (prefix + the
 * token verbatim) rather than a separate hash — this keeps
 * `deriveWorkspaceId(session.token) === session.workspaceId` true by
 * construction, which callers (e.g. a route handler re-deriving the
 * workspace id from a cookie-stored token) rely on.
 */
export function deriveWorkspaceId(token: string): string {
  return `${WORKSPACE_PREFIX}${token}`;
}
