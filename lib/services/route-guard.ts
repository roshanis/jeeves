/**
 * Shared request-guard pipeline for `app/api/**` mutating route handlers
 * (task brief deliverable 3): session (passcode-issued) -> rate-limit ->
 * input-size validation -> optional budget reserve. This module composes
 * the persistence and validation primitives while keeping route handlers
 * thin.
 *
 * Every exported check returns a discriminated `GuardFailure` (mapped by
 * the caller to the right HTTP status) or `null` (proceed). Route handlers
 * stay thin: call `runMutationGuard`, bail out on a non-null failure,
 * otherwise call the service layer.
 */
import { TokenBucketRateLimiter } from "../security/rate-limit";
import { verifyPasscode } from "../security/passcode";
import { issueSession } from "../security/session";
import { DbBudgetStore, reserve, type BudgetStore } from "../security/budget";
import { validateInputSize, type FieldLimit, type InputGap } from "../security/input-limits";
import { resolveActor } from "./actors";
import type { Actor } from "../domain/types";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { sessions } from "../db/schema";

/* -------------------------------------------------------------------------
 * Persistent session + budget state, with intentionally process-local rate
 * limiting for this demo increment.
 * ---------------------------------------------------------------------- */

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour demo session
// Per-instance rate limiting is an accepted demo posture; shared limiting is a follow-up increment.
let rateLimiter = new TokenBucketRateLimiter({ capacity: 20, refillPerSecond: 0.5 }, () => Date.now());
const budgetStore: BudgetStore = new DbBudgetStore(getDb);
const DAILY_TOKEN_CAP = 500_000;

// Security review finding #1: /api/session sits pre-session outside
// runMutationGuard, so the shared passcode was brute-forceable at wire
// speed. Dedicated slow bucket: 5 attempts per client, one refill per 30s.
let sessionAttemptLimiter = new TokenBucketRateLimiter(
  { capacity: 5, refillPerSecond: 1 / 30 },
  () => Date.now(),
);

/** Pre-session brute-force gate for POST /api/session. */
export function checkSessionAttempt(clientKey: string): { allowed: boolean; retryAfterSeconds: number } {
  return sessionAttemptLimiter.checkAndConsume(clientKey);
}

/** Test-only: reset all module-scoped guard state between test files/cases. */
export function resetGuardStateForTests(): void {
  rateLimiter = new TokenBucketRateLimiter(
    { capacity: 20, refillPerSecond: 0.5 },
    () => Date.now(),
  );
  sessionAttemptLimiter = new TokenBucketRateLimiter(
    { capacity: 5, refillPerSecond: 1 / 30 },
    () => Date.now(),
  );
  // Session and budget rows live in the DB; API tests provide a fresh PGlite
  // database for each case, so no module-scoped persistence state remains.
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
export async function issueDemoSession(
  providedPasscode: string,
  expectedPasscode: string,
  personaKey: string,
): Promise<IssueSessionResult | null> {
  const check = verifyPasscode(providedPasscode, expectedPasscode);
  if (!check.ok) return null;
  if (!resolveActor(personaKey)) return null;

  const session = issueSession({ ttlMs: SESSION_TTL_MS }, () => Date.now());
  await getDb().insert(sessions).values({
    token: session.token,
    personaKey,
    workspaceId: session.workspaceId,
    expiresAt: session.expiresAt,
  });
  return { token: session.token, workspaceId: session.workspaceId, expiresAt: session.expiresAt };
}

/**
 * Resolve a bearer/cookie session token to its `Actor`. Role ALWAYS comes
 * from the server-side persona directory keyed by the token — never from
 * anything in the request body (task brief §4).
 */
export async function resolveSessionActor(token: string | null): Promise<Actor | null> {
  if (!token) return null;

  const [session] = await getDb()
    .select({ personaKey: sessions.personaKey, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    await getDb().delete(sessions).where(eq(sessions.token, token));
    return null;
  }
  return resolveActor(session.personaKey);
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
  const actor = await resolveSessionActor(token);
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
