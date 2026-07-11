/**
 * Typed fetch helpers for the live-demo mutation API (`app/api/**` — that
 * contract is read-only for the UI layer; these helpers mirror it exactly).
 *
 * Conventions:
 * - Every helper is a pure function of its arguments (the session token is
 *   passed in explicitly) so components/tests can call them without any
 *   React context. `useLiveSession()` (lib/client/session-context.tsx) binds
 *   the current token for call sites that want it.
 * - Non-2xx responses ALWAYS throw a typed `ApiError` carrying the HTTP
 *   status and the server's `{ error }` message (plus `gaps` when present).
 *   Use `isApiError` to narrow and `apiErrorToMessage` for stable UX copy.
 * - Session-token transport is `Authorization: Bearer <token>` on every
 *   mutating call (route-guard.ts `extractSessionToken` also accepts a
 *   `jeeves_session` cookie, but the header avoids cookie-encoding and
 *   SameSite edge cases entirely).
 */
import type { Domain, LifecycleState, Tier } from "@/lib/domain/types";
import type { IntakePayload } from "@/lib/intake/types";
import type { CompletenessGap } from "@/lib/intake/completeness";

/* -------------------------------------------------------------------------
 * Error type
 * ---------------------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number;
  readonly gaps?: unknown[];

  constructor(status: number, message: string, gaps?: unknown[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.gaps = gaps;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Stable, user-facing copy per status class (task contract):
 *   401 -> re-enter passcode; 429 -> rate limit/budget; 403 -> role;
 *   400 -> surface the server's own validation message; else generic.
 */
export function apiErrorToMessage(err: ApiError): string {
  switch (err.status) {
    case 401:
      return "Session expired or invalid — enter the demo passcode again.";
    case 429:
      return "Rate limit or demo budget reached — try again shortly.";
    case 403:
      return "Not permitted for your current role.";
    case 400:
      return err.message || "Invalid request.";
    default:
      return "Something went wrong — please try again.";
  }
}

/* -------------------------------------------------------------------------
 * Response types (wire contract of app/api/** — kept local so client code
 * never imports from lib/services/*)
 * ---------------------------------------------------------------------- */

export interface SessionResult {
  token: string;
  workspaceId: string;
  expiresAt: number;
}

export interface CreateInitiativeResult {
  initiativeId: string;
  slug: string;
  intakeVersionId: string;
}

export type SubmitIntakeResult =
  | { submitted: true; completenessPct: number }
  | { submitted: false; gaps: CompletenessGap[] };

export interface TriageFastLaneResult {
  branch: "fast-lane";
  tier: Tier;
  requiredDomains: Domain[];
  riskAssessmentId: string;
  cycleId: string;
  policyId: string;
  accountableApprover: string;
}

export interface TriageReviewResult {
  branch: "review";
  tier: Tier;
  requiredDomains: Domain[];
  riskAssessmentId: string;
  cycleId: string;
}

export type TriageResult = TriageFastLaneResult | TriageReviewResult;

export interface DraftRunDomainOutcome {
  domain: Domain;
  status: "drafted" | "failed" | "skipped";
  error?: unknown;
}

export interface StartDraftRunResult {
  runId: string;
  cycleId: string;
  outcomes: DraftRunDomainOutcome[];
}

export type DraftRunDomainStatus = "pending" | "drafted" | "signed" | "returned" | "failed";

export interface DraftRunProgressRow {
  domain: Domain;
  status: DraftRunDomainStatus;
  lastError?: string;
}

export interface DraftRunProgress {
  cycleId: string;
  rows: DraftRunProgressRow[];
  complete: boolean;
}

export interface SignReviewResult {
  cycleId: string;
  domain: Domain;
  status: "signed";
}

export interface ReturnReviewResult {
  cycleId: string;
  domain: Domain;
  status: "returned";
}

export type DecisionType = "approved" | "conditionally_approved" | "rejected";

export interface DecideInput {
  decision: DecisionType;
  conditions?: { text: string; controlId: string }[];
  citations?: string[];
}

export interface DecideResult {
  initiativeId: string;
  decisionId: string;
  type: DecisionType;
  after: LifecycleState;
}

/* -------------------------------------------------------------------------
 * Core request helper
 * ---------------------------------------------------------------------- */

async function parseErrorBody(res: Response): Promise<{ message: string; gaps?: unknown[] }> {
  try {
    const body = (await res.json()) as { error?: unknown; gaps?: unknown[] };
    const message = typeof body?.error === "string" ? body.error : `request failed (${res.status})`;
    return { message, gaps: Array.isArray(body?.gaps) ? body.gaps : undefined };
  } catch {
    return { message: `request failed (${res.status})` };
  }
}

async function request<T>(
  url: string,
  options: { method: "GET" | "POST"; token?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const { message, gaps } = await parseErrorBody(res);
    throw new ApiError(res.status, message, gaps);
  }
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------
 * Route helpers (one per app/api/** route)
 * ---------------------------------------------------------------------- */

/** POST /api/session — passcode + personaKey -> session token. */
export function postSession(passcode: string, personaKey: string): Promise<SessionResult> {
  return request<SessionResult>("/api/session", {
    method: "POST",
    body: { passcode, personaKey },
  });
}

/** POST /api/initiatives — requester-only intake draft creation. */
export function createInitiative(
  token: string,
  payload: IntakePayload,
): Promise<CreateInitiativeResult> {
  return request<CreateInitiativeResult>("/api/initiatives", {
    method: "POST",
    token,
    body: { payload },
  });
}

/** POST /api/initiatives/[id]/submit — requester-only; 200 even when gaps block. */
export function submitIntake(token: string, initiativeId: string): Promise<SubmitIntakeResult> {
  return request<SubmitIntakeResult>(
    `/api/initiatives/${encodeURIComponent(initiativeId)}/submit`,
    { method: "POST", token },
  );
}

/** POST /api/initiatives/[id]/triage — any authenticated persona. */
export function runTriage(token: string, initiativeId: string): Promise<TriageResult> {
  return request<TriageResult>(`/api/initiatives/${encodeURIComponent(initiativeId)}/triage`, {
    method: "POST",
    token,
  });
}

/** POST /api/initiatives/[id]/draft-run — budget-gated agent fan-out. */
export function startDraftRun(
  token: string,
  initiativeId: string,
  domains: Domain[],
): Promise<StartDraftRunResult> {
  return request<StartDraftRunResult>(
    `/api/initiatives/${encodeURIComponent(initiativeId)}/draft-run`,
    { method: "POST", token, body: { domains } },
  );
}

/** GET /api/initiatives/[id]/draft-run?cycleId= — public progress polling. */
export function getDraftRunProgress(
  initiativeId: string,
  cycleId: string,
): Promise<DraftRunProgress> {
  return request<DraftRunProgress>(
    `/api/initiatives/${encodeURIComponent(initiativeId)}/draft-run?cycleId=${encodeURIComponent(cycleId)}`,
    { method: "GET" },
  );
}

/** POST /api/reviews/[cycleId]/[domain]/sign — reviewer-only. */
export function signReview(
  token: string,
  cycleId: string,
  domain: Domain,
  editedDraftMd?: string,
): Promise<SignReviewResult> {
  return request<SignReviewResult>(
    `/api/reviews/${encodeURIComponent(cycleId)}/${encodeURIComponent(domain)}/sign`,
    {
      method: "POST",
      token,
      body: editedDraftMd !== undefined ? { editedDraftMd } : {},
    },
  );
}

/** POST /api/reviews/[cycleId]/[domain]/return — reviewer-only, reason required. */
export function returnReview(
  token: string,
  cycleId: string,
  domain: Domain,
  reason: string,
): Promise<ReturnReviewResult> {
  return request<ReturnReviewResult>(
    `/api/reviews/${encodeURIComponent(cycleId)}/${encodeURIComponent(domain)}/return`,
    { method: "POST", token, body: { reason } },
  );
}

/** POST /api/initiatives/[id]/decide — approver-only initiative decision. */
export function decide(
  token: string,
  initiativeId: string,
  input: DecideInput,
): Promise<DecideResult> {
  return request<DecideResult>(`/api/initiatives/${encodeURIComponent(initiativeId)}/decide`, {
    method: "POST",
    token,
    body: input,
  });
}
