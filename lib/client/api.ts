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

/* --- P3 monitor + admin actions (app/api/monitor/**, app/api/admin/**) --- */

/**
 * One sustained-breach record from POST /api/monitor/run. Mirrors
 * lib/services/monitor-service.ts#BreachDetail — redeclared here so client
 * code never imports server modules (this file's header convention).
 */
export interface BreachDetail {
  initiativeId: string;
  deploymentId: string;
  controlId: string;
  windowStartTs: number;
  identityKey: string;
  threshold: number;
  breachingValues: number[];
  /** True only when this run created the incident; false when already known (idempotent re-run). */
  isNew: boolean;
  incidentId: string;
  reviewCycleId: string | null;
}

export interface RunMonitorResult {
  evaluated: number;
  breaches: BreachDetail[];
  incidentsCreated: number;
  alreadyKnown: number;
}

/** Row shape of GET /api/monitor/incidents (timestamps are ISO strings on the wire). */
export interface IncidentListRow {
  id: string;
  deploymentId: string;
  controlId: string;
  windowStart: string;
  detectedAt: string;
  reviewCycleId: string | null;
  resolvedAt: string | null;
}

export interface SetThresholdInput {
  controlId: string;
  /**
   * Scope selector, matching the route's ACTUAL behavior (the
   * `parsed.data.initiativeId ?? null` mapping in
   * app/api/admin/threshold/route.ts): a string -> project/deployment
   * override for that initiative; `null` OR omitted -> tier-default change,
   * in which case `tier` is required. (The route's own doc comment says
   * "omitted -> project override" but its code maps omitted to null =
   * tier-default; the code is authoritative — mismatch flagged upstream.)
   */
  initiativeId?: string | null;
  tier?: Tier;
  value: number;
  reason: string;
}

export interface SetThresholdResult {
  controlId: string;
  scope: "tier-default" | "project-override";
  tier?: Tier;
  initiativeId?: string;
  before: number | null;
  after: number;
}

export interface PauseResumeResult {
  initiativeId: string;
  deploymentId: string;
  before: LifecycleState;
  after: LifecycleState;
}

/* --- M2 chat + M3 promotions (app/api/chat/**, app/api/deployments/**) --- */

/** Row shape of GET /api/deployments/promotions (mirrors promotion-service.ts#PromotionListItem). */
export interface PromotionListItem {
  deploymentVersionId: string;
  initiativeId: string;
  initiativeSlug: string;
  initiativeTitle: string;
  tier: string | null;
  version: string;
  modelVersion: string | null;
  feedbackProvenanceSignedOff: boolean;
  deployedAt: string;
  supersedesVersion: string | null;
}

/** Result shape of POST /api/deployments/promotions/[id]/promote (mirrors promotion-service.ts#PromoteCheckpointResult). */
export interface PromoteCheckpointResult {
  initiativeId: string;
  promotedDeploymentVersionId: string;
  promotedVersion: string;
  supersededDeploymentVersionId: string | null;
  supersededVersion: string | null;
  status: "deployed";
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

/**
 * POST /api/monitor/run — evaluate Q-01 across deployed initiatives. Any
 * authenticated session role may trigger it (the route's guard requires a
 * session but no specific role; the server always applies the resulting
 * pause/reassessment as the `system` actor).
 *
 * `nowTs` (epoch ms) is optional ON PURPOSE: when omitted, the body is `{}`
 * and the SERVER applies its own canonical demo default
 * (`DEFAULT_MONITOR_NOW_TS` = base+14d in app/api/monitor/run/route.ts) —
 * omitting keeps the client permanently in sync with that constant without
 * duplicating it here (the route file can't be imported into client code:
 * it pulls the server-only DB/service graph into the bundle).
 */
export function runMonitor(token: string, nowTs?: number): Promise<RunMonitorResult> {
  return request<RunMonitorResult>("/api/monitor/run", {
    method: "POST",
    token,
    body: nowTs !== undefined ? { nowTs: new Date(nowTs).toISOString() } : {},
  });
}

/** GET /api/monitor/incidents — public read-only incident list (no session). */
export async function listIncidents(): Promise<IncidentListRow[]> {
  const result = await request<{ incidents: IncidentListRow[] }>("/api/monitor/incidents", {
    method: "GET",
  });
  return result.incidents;
}

/** POST /api/admin/threshold — admin-only Q-01 threshold change (reason required). */
export function setThreshold(
  token: string,
  input: SetThresholdInput,
): Promise<SetThresholdResult> {
  return request<SetThresholdResult>("/api/admin/threshold", {
    method: "POST",
    token,
    body: {
      controlId: input.controlId,
      // Explicit null (tier-default) must survive serialization; undefined
      // is dropped by JSON.stringify, which the route also treats as null.
      initiativeId: input.initiativeId ?? null,
      tier: input.tier,
      value: input.value,
      reason: input.reason,
    },
  });
}

/** POST /api/admin/deployments/[id]/pause — admin-only; [id] is the INITIATIVE id. */
export function pauseDeployment(
  token: string,
  initiativeId: string,
  reason: string,
): Promise<PauseResumeResult> {
  return request<PauseResumeResult>(
    `/api/admin/deployments/${encodeURIComponent(initiativeId)}/pause`,
    { method: "POST", token, body: { reason } },
  );
}

/** POST /api/admin/deployments/[id]/resume — admin-only; valid from paused AND re_review. */
export function resumeDeployment(
  token: string,
  initiativeId: string,
  reason: string,
): Promise<PauseResumeResult> {
  return request<PauseResumeResult>(
    `/api/admin/deployments/${encodeURIComponent(initiativeId)}/resume`,
    { method: "POST", token, body: { reason } },
  );
}

/**
 * POST /api/chat/auditor — natural-language audit Q&A. Session-gated for ANY
 * authenticated persona (not role-restricted, unlike the intake chat below).
 */
export function askAuditor(
  token: string,
  input: { question: string },
): Promise<{ answerMd: string; citedEvents: string[]; queryUsed: string; rows: unknown[] }> {
  return request<{ answerMd: string; citedEvents: string[]; queryUsed: string; rows: unknown[] }>(
    "/api/chat/auditor",
    { method: "POST", token, body: input },
  );
}

/**
 * POST /api/chat/intake — conversational intake interviewer turn. Session-
 * gated for the requester persona specifically (403 for any other role).
 * `updatedPayload` is always a full coerced `IntakePayload` per the route's
 * `coerceToIntakePayload`.
 */
export function intakeChat(
  token: string,
  input: { conversation: { role: "user" | "assistant"; content: string }[]; partialPayload: unknown },
): Promise<{ reply: string; updatedPayload: IntakePayload; gaps: CompletenessGap[]; done: boolean }> {
  return request<{
    reply: string;
    updatedPayload: IntakePayload;
    gaps: CompletenessGap[];
    done: boolean;
  }>("/api/chat/intake", { method: "POST", token, body: input });
}

/** GET /api/deployments/promotions — public read-only list of RL checkpoints awaiting sign-off. */
export function listPromotions(): Promise<PromotionListItem[]> {
  return request<PromotionListItem[]>("/api/deployments/promotions", { method: "GET" });
}

/** POST /api/deployments/promotions/[id]/promote — approver-only; [id] is the deploymentVersionId. */
export function promoteCheckpoint(
  token: string,
  id: string,
  input: {
    attestation: { feedbackDataSource: string; consentBasis: string; reviewedBy: string };
    reason: string;
  },
): Promise<PromoteCheckpointResult> {
  return request<PromoteCheckpointResult>(
    `/api/deployments/promotions/${encodeURIComponent(id)}/promote`,
    { method: "POST", token, body: input },
  );
}
