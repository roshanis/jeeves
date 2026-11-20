import { randomBytes } from "node:crypto";

/**
 * Demo-workspace session tokens (plan §3: "runs in an isolated demo
 * workspace (session-scoped data namespace, resettable)"). Pure logic —
 * no cookie/header wiring here; a Next.js route handler issues/reads the
 * token via whatever transport it chooses and calls into this module for
 * generation/validation/expiry and workspace-id generation.
 */

export interface SessionConfig {
  /** Time-to-live in milliseconds from issuance. */
  ttlMs: number;
}

export interface Session {
  /** Opaque random session token (the workspace id is independent of it). */
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
    workspaceId: generateWorkspaceId(),
  };
}

/**
 * Workspace id (data-namespacing key). Generated independently of the bearer
 * token on purpose: the id is copied into business tables, the signed
 * workspace cookie and database error text, so it must never be a credential.
 */
function generateWorkspaceId(): string {
  return `${WORKSPACE_PREFIX}${randomBytes(TOKEN_BYTES).toString("hex")}`;
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
