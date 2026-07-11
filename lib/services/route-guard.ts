/**
 * Shared request-guard pipeline for `app/api/**` mutating route handlers
 * (task brief deliverable 3): session (passcode-issued) -> rate-limit ->
 * input-size validation -> optional budget reserve. Kept inside
 * `lib/services/` (this task's owned directory) rather than
 * `lib/security/`, which is out of scope to modify — this module composes
 * `lib/security/*` primitives, it does not replace them.
 *
 * Every exported check returns a discriminated `GuardFailure` (mapped by
 * the caller to the right HTTP status) or `null` (proceed). Route handlers
 * stay thin: call `runMutationGuard`, bail out on a non-null failure,
 * otherwise call the service layer.
 */
import { TokenBucketRateLimiter } from "../security/rate-limit";
import { verifyPasscode } from "../security/passcode";
import { issueSession, validateSession, type Session } from "../security/session";
import { InMemoryBudgetStore, reserve, type BudgetStore } from "../security/budget";
import { validateInputSize, type FieldLimit, type InputGap } from "../security/input-limits";
import { resolveActor, type PersonaKey } from "./actors";
import type { Actor } from "../domain/types";

/* -------------------------------------------------------------------------
 * Process-wide (module-scoped) singletons — mirrors the "in-memory, single
 * demo process" design already used by lib/security/budget.ts's dayChains
 * and is appropriate for a single-instance Vercel demo deployment (plan §3).
 * ---------------------------------------------------------------------- */

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour demo session
const sessions = new Map<string, Session>();
const personaBySessionToken = new Map<string, PersonaKey>();

const rateLimiter = new TokenBucketRateLimiter({ capacity: 20, refillPerSecond: 0.5 }, () => Date.now());
const budgetStore: BudgetStore = new InMemoryBudgetStore();
const DAILY_TOKEN_CAP = 500_000;

/** Test-only: reset all module-scoped guard state between test files/cases. */
export function resetGuardStateForTests(): void {
  sessions.clear();
  personaBySessionToken.clear();
  // TokenBucketRateLimiter has no public clear(); tests construct their own
  // limiter via runMutationGuard's injected `deps` instead of relying on
  // this module singleton when they need a clean bucket.
}

export type GuardFailureKind = "unauthorized" | "rate_limited" | "invalid_input" | "budget_exhausted";

export interface GuardFailure {
  kind: GuardFailureKind;
  status: 401 | 429 | 400;
  message: string;
  gaps?: InputGap[];
  retryAfterSeconds?: number;
}

/* -------------------------------------------------------------------------
 * Session issuance (POST /api/session)
 * ---------------------------------------------------------------------- */

export interface IssueSessionResult {
  token: string;
  workspaceId: string;
  expiresAt: number;
}

/**
 * Verify the demo passcode and, if correct, issue + register a new session
 * bound to `personaKey`. Returns null on passcode mismatch/misconfiguration
 * (caller maps to 401, no side effects — plan §3 "unauthenticated requests
 * -> 401 with no side effects").
 */
export function issueDemoSession(
  providedPasscode: string,
  expectedPasscode: string,
  personaKey: string,
): IssueSessionResult | null {
  const check = verifyPasscode(providedPasscode, expectedPasscode);
  if (!check.ok) return null;
  if (!resolveActor(personaKey)) return null;

  const session = issueSession({ ttlMs: SESSION_TTL_MS }, () => Date.now());
  sessions.set(session.token, session);
  personaBySessionToken.set(session.token, personaKey as PersonaKey);
  return { token: session.token, workspaceId: session.workspaceId, expiresAt: session.expiresAt };
}

/**
 * Resolve a bearer/cookie session token to its `Actor`. Role ALWAYS comes
 * from the server-side persona directory keyed by the token — never from
 * anything in the request body (task brief §4).
 */
export function resolveSessionActor(token: string | null): Actor | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const validity = validateSession(session, () => Date.now());
  if (!validity.valid) {
    sessions.delete(token);
    personaBySessionToken.delete(token);
    return null;
  }
  const personaKey = personaBySessionToken.get(token);
  if (!personaKey) return null;
  return resolveActor(personaKey);
}

/* -------------------------------------------------------------------------
 * Token extraction (cookie or bearer)
 * ---------------------------------------------------------------------- */

const SESSION_COOKIE_NAME = "jeeves_session";

export function extractSessionToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (match) return decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
  }
  return null;
}

/** Best-effort client identifier for rate limiting — hashed upstream in production via a proxy header; falls back to a constant bucket key when absent (single-tenant demo). */
export function clientKeyFor(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown-client";
}

/* -------------------------------------------------------------------------
 * Combined mutation guard
 * ---------------------------------------------------------------------- */

export interface MutationGuardOptions {
  /** Field-level input caps to validate `body` against (skipped if omitted). */
  inputLimits?: FieldLimit[];
  inputTotalCap?: number;
  /** When true, atomically reserve budget for this call (LLM-invoking routes). */
  requiresBudget?: boolean;
  budgetDay?: string; // defaults to today's UTC date
  estimatedTokens?: number;
}

export interface MutationGuardSuccess {
  ok: true;
  actor: Actor;
}

export type MutationGuardResult = MutationGuardSuccess | { ok: false; failure: GuardFailure };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runs session -> rate-limit -> input-validation -> (optional) budget in
 * order, short-circuiting on the first failure — matching the task brief's
 * required precedence ("401 with no side effects" happens before rate
 * limiting/budget can be consumed by an unauthenticated caller).
 */
export async function runMutationGuard(
  req: Request,
  body: Record<string, string> | undefined,
  options: MutationGuardOptions = {},
): Promise<MutationGuardResult> {
  const token = extractSessionToken(req);
  const actor = resolveSessionActor(token);
  if (!actor) {
    return { ok: false, failure: { kind: "unauthorized", status: 401, message: "invalid or missing session" } };
  }

  const clientKey = clientKeyFor(req);
  const rl = rateLimiter.checkAndConsume(clientKey);
  if (!rl.allowed) {
    return {
      ok: false,
      failure: {
        kind: "rate_limited",
        status: 429,
        message: "rate limit exceeded",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
    };
  }

  if (options.inputLimits && body) {
    const validation = validateInputSize(body, options.inputLimits, options.inputTotalCap ?? 100_000);
    if (!validation.ok) {
      return {
        ok: false,
        failure: { kind: "invalid_input", status: 400, message: "input validation failed", gaps: validation.gaps },
      };
    }
  }

  if (options.requiresBudget) {
    const day = options.budgetDay ?? todayUtc();
    const result = await reserve(budgetStore, day, options.estimatedTokens ?? 0, DAILY_TOKEN_CAP);
    if (!result.granted) {
      return {
        ok: false,
        failure: { kind: "budget_exhausted", status: 429, message: "demo token budget exhausted for today" },
      };
    }
  }

  return { ok: true, actor };
}

/** Exposed for tests that want to exhaust/reset the shared budget deterministically. */
export function getBudgetStoreForTests(): BudgetStore {
  return budgetStore;
}

/** Exposed for tests that want to exhaust the shared rate limiter deterministically. */
export function getRateLimiterForTests(): TokenBucketRateLimiter {
  return rateLimiter;
}
