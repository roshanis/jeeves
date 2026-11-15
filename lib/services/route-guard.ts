import { runtimeDatabaseUrl } from "../db/runtime-config";
/**
 * Shared request-guard pipeline for `app/api/**` mutating route handlers
 * (task brief deliverable 3): writable mode -> session (server-issued) -> rate-limit ->
 * input-size validation -> optional budget reserve. This module composes
 * the persistence and validation primitives while keeping route handlers
 * thin.
 *
 * Every exported check returns a discriminated `GuardFailure` (mapped by
 * the caller to the right HTTP status) or `null` (proceed). Route handlers
 * stay thin: call `runMutationGuard`, bail out on a non-null failure,
 * otherwise call the service layer.
 */
import { DbTokenBucketRateLimiter } from "../security/db-rate-limit";
import { issueSession } from "../security/session";
import { DAILY_TOKEN_CAP, DbBudgetStore, reserve, type BudgetStore } from "../security/budget";
import { validateInputSize, type FieldLimit, type InputGap } from "../security/input-limits";
import { PUBLIC_PERSONA_PREFIX, isPersonaKey, resolveActor } from "./actors";
import type { Actor } from "../domain/types";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { resolveWorkspaceCookieSecret } from "../security/workspace-cookie";
import { getDb } from "../db/client";
import { BodyReadError, DEFAULT_BODY_MAX_BYTES, readJsonBody } from "../http/read-json-body";
import { redactDbError } from "../db/redact-error";
import { sessions } from "../db/schema";
import { READ_ONLY_PREVIEW_MESSAGE, resolveDataProviderMode } from "../data/provider-mode";

// Sessions, budgets and rate limits live in Postgres across server instances.
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour demo session
/** Long enough to fill in one intake form, short enough not to be a handle. */
const PUBLIC_SESSION_TTL_MS = 30 * 60 * 1000;
/**
 * Marks a workspace as belonging to a public submitter. Only the operator
 * queue (behind OPERATOR_TOKEN), the public-session mint and the installation
 * check use it; no persona role may read public submissions, and mutation
 * stays an exact workspace match, so visitors stay isolated from each other.
 */
export const PUBLIC_WORKSPACE_PREFIX = "public-";
const rateLimiter = new DbTokenBucketRateLimiter(
  { capacity: 20, refillPerSecond: 0.5 },
  getDb,
  () => Date.now(),
);

/**
 * Bucket key for a policy and client. The client address is keyed by a
 * truncated HMAC under the server secret so addresses are not stored in
 * clear. With no secret configured (local development) the address is kept.
 */
function bucketKey(policy: string, clientKey: string): string {
  const secret = resolveWorkspaceCookieSecret();
  if (!secret) return `${policy}:${clientKey}`;
  return `${policy}:${createHmac("sha256", secret).update(`rate-limit-client:${clientKey}`).digest("hex").slice(0, 32)}`;
}

/** Longer than any policy needs to refill from empty (slowest: 10 tokens at 1/min), so a bucket untouched this long is full. */
const STALE_BUCKET_MS = 60 * 60 * 1000;
const HOUSEKEEPING_BATCH = 500;
const HOUSEKEEPING_EVERY = 100;
let housekeepingCalls = 0;

/** Test hook: set how many guarded calls this process has already counted (0 = the next call prunes). */
export function resetHousekeepingCounterForTests(calls = 0): void {
  housekeepingCalls = calls;
}

/** Delete stale rate-limit buckets and expired sessions, a bounded batch of each. */
export async function pruneStaleState(): Promise<void> {
  await rateLimiter.prune(STALE_BUCKET_MS, HOUSEKEEPING_BATCH);
  await getDb().execute(sql`
    delete from "sessions" where "token" in (
      select "token" from "sessions" where "expires_at" <= ${Date.now()}::bigint limit ${HOUSEKEEPING_BATCH}
    )
  `);
}

/**
 * The first guarded call of a process and every 100th after it pay for
 * housekeeping: a short-lived serverless instance still prunes once, a
 * long-lived one prunes in proportion to traffic. Deterministic (no
 * randomness); it never fails the request.
 */
async function maybePruneStaleState(): Promise<void> {
  if (housekeepingCalls++ % HOUSEKEEPING_EVERY !== 0) return;
  try {
    await pruneStaleState();
  } catch (err) {
    console.error("Housekeeping failed", { errorName: redactDbError(err).name });
  }
}

const budgetStore: BudgetStore = new DbBudgetStore(getDb);

// Anonymous workspace creation stays bounded separately from business actions.
const sessionAttemptLimiter = new DbTokenBucketRateLimiter(
  { capacity: 5, refillPerSecond: 1 / 30 },
  getDb,
  () => Date.now(),
);

/**
 * Public (passcode-free) intake sessions — POST /api/public-session.
 *
 * There is no passcode to brute-force here, so this bucket is not about
 * guessing: it is the ceiling on how fast one client can mint identities
 * and therefore how fast it can write rows. Deliberately tighter and
 * slower-refilling than the authenticated mutation limiter, because the
 * caller is anonymous and the only cost of asking is a request.
 */
const publicSessionLimiter = new DbTokenBucketRateLimiter(
  { capacity: 10, refillPerSecond: 1 / 60 },
  getDb,
  () => Date.now(),
);

/**
 * A public submitter's session: no passcode, `public` role, its own
 * workspace.
 *
 * The role is the safety property (see lib/domain/types.ts). It is enforced
 * in `runMutationGuard` below, not by each route's own role check: several
 * routes deliberately have none, so per-route checks would have left holes
 * (see MutationGuardOptions.allowPublic for which, and why). This session
 * therefore holds nothing except what the three intake routes opt it into.
 * The TTL is short — a visitor fills one form; they do not need an hour.
 */
export async function issuePublicSession(
  clientKey: string,
): Promise<
  | IssueSessionResult
  | { rateLimited: true; retryAfterSeconds: number }
  | { readOnly: GuardFailure }
> {
  const readOnly = checkReadOnlyMode();
  if (readOnly) return { readOnly };

  // Namespaced like every other limiter here: the buckets share one table, and
  // an un-prefixed key would share a balance with another policy.
  await maybePruneStaleState();
  const attempt = await publicSessionLimiter.checkAndConsume(bucketKey("public-session", clientKey));
  if (!attempt.allowed) {
    return { rateLimited: true, retryAfterSeconds: attempt.retryAfterSeconds };
  }

  const session = issueSession({ ttlMs: PUBLIC_SESSION_TTL_MS }, () => Date.now());
  // Prefixed so the workspace is identifiable as a public submission later,
  // without changing what it MEANS for mutation: workspaceMismatch() still
  // demands an exact match, so one visitor cannot touch another's draft.
  const workspaceId = `${PUBLIC_WORKSPACE_PREFIX}${session.workspaceId}`;
  // Independent of the token on purpose: this becomes actor.id and is written
  // to audit_events.actor. It used to be token.slice(0, 32) — half the live
  // session token, stored in a column built to be read by humans.
  const personaKey = `${PUBLIC_PERSONA_PREFIX}${randomUUID()}`;

  await getDb()
    .insert(sessions)
    .values({
      token: session.token,
      personaKey,
      workspaceId,
      expiresAt: session.expiresAt,
    })
    // The driver error embeds the bound token; never let it reach the log.
    .catch((err: unknown) => {
      throw redactDbError(err);
    });
  return { token: session.token, workspaceId, expiresAt: session.expiresAt };
}


// Switching an existing session is separately bounded so exploring the eight
// reviewer roles does not exhaust the anonymous workspace-creation allowance.
const personaSwitchLimiter = new DbTokenBucketRateLimiter(
  { capacity: 20, refillPerSecond: 0.2 }, getDb, () => Date.now(),
);

/** Separate limits for anonymous entry and authenticated persona switching. */
export async function checkSessionAttempt(
  clientKey: string,
  switching = false,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  await maybePruneStaleState();
  return switching
    ? personaSwitchLimiter.checkAndConsume(bucketKey("persona-switch", clientKey))
    : sessionAttemptLimiter.checkAndConsume(bucketKey("session", clientKey));
}

/* -------------------------------------------------------------------------
 * Operator credential — GET /api/public-intake
 *
 * The inbound request queue holds what strangers typed (names, emails), so it
 * cannot be gated by persona role: the passwordless playground hands any
 * visitor any persona, Program Office and Admin included. It is gated by
 * OPERATOR_TOKEN instead, a server-side secret held by whoever runs the site.
 * ---------------------------------------------------------------------- */

/** Below this, a token is treated as unconfigured: a guessable operator
 *  secret would make everything else here moot. */
export const OPERATOR_TOKEN_MIN_LENGTH = 32;

/** The configured operator token, or null when the queue is switched off. */
export function configuredOperatorToken(): string | null {
  const token = process.env.OPERATOR_TOKEN?.trim() ?? "";
  return token.length >= OPERATOR_TOKEN_MIN_LENGTH ? token : null;
}

/**
 * Constant-time check of `Authorization: Bearer <token>` against the
 * configured operator token. Both sides are hashed first so the comparison
 * runs over equal-length buffers regardless of what the caller sent — a raw
 * timingSafeEqual would throw (and leak) on a length mismatch.
 */
export function isOperatorAuthorized(authorization: string | null, expected: string): boolean {
  const match = authorization?.match(/^Bearer (.+)$/);
  if (!match) return false;
  const given = createHash("sha256").update(match[1]!).digest();
  const want = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, want);
}

/** Failed-attempt ceiling for the operator queue — cheap insurance on top of
 *  a >= 32-character secret, and it keeps probing from loading the DB. */
const operatorAttemptLimiter = new DbTokenBucketRateLimiter(
  { capacity: 10, refillPerSecond: 1 / 30 },
  getDb,
  () => Date.now(),
);

export async function checkOperatorAttempt(
  clientKey: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return operatorAttemptLimiter.checkAndConsume(bucketKey("operator", clientKey));
}

export type GuardFailureKind = "unauthorized" | "rate_limited" | "invalid_input" | "budget_exhausted" | "read_only" | "payload_too_large";

export interface GuardFailure {
  kind: GuardFailureKind;
  status: 401 | 403 | 429 | 400 | 413;
  message: string;
  gaps?: InputGap[];
  retryAfterSeconds?: number;
}

/** The JSON response for a failed guard: keeps `gaps` and `retryAfterSeconds` and sets Retry-After on a 429. */
export function guardFailureResponse(failure: GuardFailure, headers: Record<string, string> = {}): Response {
  const retry: Record<string, string> = failure.retryAfterSeconds !== undefined ? { "Retry-After": String(failure.retryAfterSeconds) } : {};
  return Response.json(
    {
      error: failure.message,
      ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
      ...(failure.gaps ? { gaps: failure.gaps } : {}),
    },
    { status: failure.status, headers: { ...headers, ...retry } },
  );
}

/** Static preview reads cannot reflect writes, so reject before any DB access. */
export function checkReadOnlyMode(): GuardFailure | null {
  return resolveDataProviderMode(process.env.DATA_PROVIDER, !!runtimeDatabaseUrl()) === "mock"
    ? { kind: "read_only", status: 403, message: READ_ONLY_PREVIEW_MESSAGE }
    : null;
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
 * Issue a public demo session bound to a known fictional persona.
 * Returns null in preview mode or for unknown personas. Workspace ids passed here must already
 * be verified by the route through a valid session or signed browser cookie.
 *
 * `existingWorkspaceId` (M2.5 inc.2b — per-browser workspace reuse): when a
 * non-empty value is passed (the caller's incoming `jeeves_workspace`
 * cookie), the issued session and returned result use THAT workspaceId
 * instead of a freshly generated one, so the champion demo flow (requester
 * creates -> reviewer signs -> approver decides, all separate logins in one
 * browser) keeps seeing the same workspace across logins. Omitted/empty ->
 * unchanged behavior (fresh workspaceId derived from the new token).
 */
export async function issueDemoSession(
  personaKey: string,
  existingWorkspaceId?: string | null,
): Promise<IssueSessionResult | null> {
  if (checkReadOnlyMode()) return null;
  // Demo personas only — never a `public:` key (see app/api/session/route.ts).
  if (!isPersonaKey(personaKey) || !resolveActor(personaKey)) return null;
  // Invariant, held here rather than trusted to every caller: no persona
  // session ever lives in a real-request workspace. Those hold requests sent
  // to the site's operators, and the operator queue lists everything in them.
  if (existingWorkspaceId?.startsWith(PUBLIC_WORKSPACE_PREFIX)) existingWorkspaceId = null;

  const session = issueSession({ ttlMs: SESSION_TTL_MS }, () => Date.now());
  const workspaceId = existingWorkspaceId ? existingWorkspaceId : session.workspaceId;
  await getDb()
    .insert(sessions)
    .values({
      token: session.token,
      personaKey,
      workspaceId,
      expiresAt: session.expiresAt,
    })
    // The driver error embeds the bound token; never let it reach the log.
    .catch((err: unknown) => {
      throw redactDbError(err);
    });
  return { token: session.token, workspaceId, expiresAt: session.expiresAt };
}

export interface ResolvedSession {
  actor: Actor | null;
  workspaceId: string | null;
}

/**
 * Resolve a bearer/cookie session token to its `Actor` + the session's
 * `workspaceId` (M2.5 inc.2a — workspace isolation foundation). Role ALWAYS
 * comes from the server-side persona directory keyed by the token — never
 * from anything in the request body (task brief §4).
 */
export async function resolveSession(token: string | null): Promise<ResolvedSession> {
  if (!token) return { actor: null, workspaceId: null };

  const [session] = await getDb()
    .select({
      personaKey: sessions.personaKey,
      expiresAt: sessions.expiresAt,
      workspaceId: sessions.workspaceId,
    })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1)
    // The driver error embeds the bound token; never let it reach the log.
    .catch((err: unknown) => {
      throw redactDbError(err);
    });
  if (!session) return { actor: null, workspaceId: null };

  if (session.expiresAt <= Date.now()) {
    await getDb()
      .delete(sessions)
      .where(eq(sessions.token, token))
      .catch((err: unknown) => {
        throw redactDbError(err);
      });
    return { actor: null, workspaceId: null };
  }
  return { actor: resolveActor(session.personaKey), workspaceId: session.workspaceId ?? null };
}

/**
 * Resolve a bearer/cookie session token to its `Actor`. Role ALWAYS comes
 * from the server-side persona directory keyed by the token — never from
 * anything in the request body (task brief §4).
 *
 * Kept as a thin wrapper over `resolveSession` for existing callers/tests
 * that only need the actor.
 */
export async function resolveSessionActor(token: string | null): Promise<Actor | null> {
  return (await resolveSession(token)).actor;
}

/* -------------------------------------------------------------------------
 * Token extraction (cookie or bearer)
 * ---------------------------------------------------------------------- */

const SESSION_COOKIE_NAME = "jeeves_session";

export function extractSessionToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth)) {
    const bearer = auth.slice("Bearer ".length).trim();
    // U+0000 cannot be stored in Postgres text: such a token is signed out, not a 500.
    return bearer.includes("\u0000") ? null : bearer;
  }
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (match) {
      // A stray "%" must read as "no session", not throw into a 500.
      try {
        const cookie = decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
        return cookie.includes("\u0000") ? null : cookie;
      } catch {
        return null;
      }
    }
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
  /**
   * Opt this route in for passcode-free `public` sessions. Defaults to
   * FALSE, which is the entire safety model for public submission: the
   * guard — not each route's own role check — is the boundary, so a route
   * added tomorrow is closed to anonymous callers without its author having
   * to know this feature exists.
   *
   * Per-route role checks are not sufficient on their own here. Several
   * routes deliberately have none, because they substitute a different
   * actor and let the lifecycle decide: `triage` passes SYSTEM_ACTOR, and
   * `monitor/run` runs as `system`. Their "any authenticated persona may
   * trigger this" rationale was written when authenticated meant
   * passcode-holding. `agents/health` has no role check either and is
   * budget-gated, so it would have let an anonymous caller invoke the
   * AgentPort.
   *
   * Exactly three routes set this: create initiative, edit intake draft,
   * submit intake.
   */
  allowPublic?: boolean;
  /** Byte cap for the JSON body the guard reads (default 1 MiB). */
  maxBodyBytes?: number;
  /** An empty or malformed body reads as `{}` instead of failing 400. */
  bodyOptional?: boolean;
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
  /** The session's bound workspace (M2.5 inc.2a). Null if somehow absent. */
  workspaceId: string | null;
  /** The parsed JSON body, read only after the session, rate limit and cap passed. Undefined when the route gave no extractor. */
  json?: unknown;
}

/** Maps the parsed JSON body to the flat string fields that `inputLimits` check. */
export type BodyExtractor = (json: unknown) => Record<string, string> | undefined;

export type MutationGuardResult = MutationGuardSuccess | { ok: false; failure: GuardFailure };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rejects static preview mode, then runs session -> rate-limit -> (when `body`
 * is an extractor) capped body read -> input-validation -> (optional) budget in order, short-circuiting on the first failure — matching the task brief's
 * required precedence ("401 with no side effects" happens before rate
 * limiting/budget can be consumed by an unauthenticated caller).
 */
export async function runMutationGuard(
  req: Request,
  body: Record<string, string> | BodyExtractor | undefined,
  options: MutationGuardOptions = {},
): Promise<MutationGuardResult> {
  const readOnlyFailure = checkReadOnlyMode();
  if (readOnlyFailure) return { ok: false, failure: readOnlyFailure };

  const token = extractSessionToken(req);
  const { actor, workspaceId } = await resolveSession(token);
  if (!actor || !workspaceId) {
    return { ok: false, failure: { kind: "unauthorized", status: 401, message: "invalid or missing session" } };
  }

  // Deny-by-default for public sessions — see MutationGuardOptions.allowPublic.
  // Placed before the rate-limit consume so a rejected anonymous caller does
  // not spend another session's budget of tokens.
  if (actor.role === "public" && !options.allowPublic) {
    return {
      ok: false,
      failure: {
        kind: "unauthorized",
        status: 403,
        message: "this action requires a demo session",
      },
    };
  }

  const clientKey = clientKeyFor(req);
  // Independent policies must not share a persisted token balance.
  const rl = await rateLimiter.checkAndConsume(bucketKey("mutation", clientKey));
  await maybePruneStaleState();
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

  let json: unknown;
  let fields: Record<string, string> | undefined;
  if (typeof body === "function") {
    try {
      json = await readJsonBody(req, options.maxBodyBytes ?? DEFAULT_BODY_MAX_BYTES, { optional: options.bodyOptional });
    } catch (err) {
      if (!(err instanceof BodyReadError)) throw err;
      return err.status === 413
        ? { ok: false, failure: { kind: "payload_too_large", status: 413, message: err.message } }
        : { ok: false, failure: { kind: "invalid_input", status: 400, message: err.message } };
    }
    fields = body(json);
  } else {
    fields = body;
  }

  if (options.inputLimits && fields) {
    const validation = validateInputSize(fields, options.inputLimits, options.inputTotalCap ?? 100_000);
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
        failure: { kind: "budget_exhausted", status: 429, message: "daily model budget reached" },
      };
    }
  }

  return { ok: true, actor, workspaceId, json };
}

/**
 * Reserve daily LLM budget after a route has authenticated, role-checked and
 * validated the request and sized the real prompt, so refused or malformed
 * calls never spend the shared cap. Returns a failure when the cap is spent.
 */
export async function reserveDailyBudget(tokens: number, day: string = todayUtc()): Promise<GuardFailure | null> {
  const result = await reserve(budgetStore, day, tokens, DAILY_TOKEN_CAP);
  if (result.granted) return null;
  return { kind: "budget_exhausted", status: 429, message: "daily model budget reached" };
}

/** Exposed for tests that want to exhaust/reset the shared budget deterministically. */
export function getBudgetStoreForTests(): BudgetStore {
  return budgetStore;
}
