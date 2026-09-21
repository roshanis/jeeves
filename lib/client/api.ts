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
import { READ_ONLY_PREVIEW_MESSAGE } from "@/lib/data/provider-mode";

/* -------------------------------------------------------------------------
 * Error type
 * ---------------------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number;
  readonly gaps?: unknown[];
  readonly code?: string;

  constructor(status: number, message: string, gaps?: unknown[], code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.gaps = gaps;
    this.code = code;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Stable, user-facing copy per status class (task contract):
 *   401 -> restart demo session; 429 -> rate limit/budget; 403 -> role;
 *   400 -> surface the server's own validation message; else generic.
 */
export function apiErrorToMessage(err: ApiError): string {
  if (err.status === 403 && err.message === READ_ONLY_PREVIEW_MESSAGE) {
    return READ_ONLY_PREVIEW_MESSAGE;
  }
  if (err.status === 503 && err.code === "DEMO_NOT_CONFIGURED") {
    return "The demo is temporarily unavailable. Please try again later.";
  }
  if (err.status === 503 && err.code === "AGENT_INITIALIZATION_FAILED") {
    return "Agents could not start. Test the connection on the Agents page, then retry.";
  }
  switch (err.status) {
    case 401:
      return "Session expired or invalid — start the demo again.";
    case 429:
      return "Rate limit or demo budget reached — try again shortly.";
    case 403:
      return "Not permitted for your current role.";
    case 409:
      return "This record changed. Refresh and review the latest information before trying again.";
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
  version: number;
}

export interface IntakeDraftResult extends CreateInitiativeResult {
  payload: IntakePayload;
  version: number;
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
  reason?: "already signed" | "already running" | "superseded";
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

export interface RunReviewAgentResult {
  cycleId: string;
  domain: Domain;
  status: "drafted" | "failed" | "skipped";
  /** Fresh draft markdown — present only when status === "drafted". */
  draftMd?: string;
  /** Human-readable failure reason — present only when status === "failed". */
  error?: string;
  /** Present when a concurrent human signature wins the persistence race. */
  reason?: "already signed" | "already running" | "superseded";
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
  /**
   * Present only for approved/conditionally_approved decisions (external-
   * review finding #4): decide() now generates the deployment's effective
   * controls itself, atomically with the decision. Mirrors
   * lib/services/initiative-service.ts#DecideResult.
   */
  controlsGenerated?: { deploymentId: string; created: number };
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
  /**
   * Present (and `true`) only when the breach was DETECTED but its
   * persistence transaction threw — `incidentId` is `""` and nothing was
   * written. Mirrors monitor-service.ts#BreachDetail.
   */
  failed?: true;
}

/** Mirrors lib/services/monitor-service.ts#RunMonitorError. */
export interface RunMonitorError {
  initiativeId: string;
  deploymentId: string;
  message: string;
}

export interface RunMonitorResult {
  evaluated: number;
  breaches: BreachDetail[];
  incidentsCreated: number;
  alreadyKnown: number;
  /**
   * Per-candidate failures that did not abort the run. A run with a
   * non-empty `errors` must never be presented as a clean pass — some
   * breaches may have been detected but not recorded.
   */
  errors?: RunMonitorError[];
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

/** One deployment_versions row for an initiative (mirrors promotion-service.ts#DeploymentHistoryEntry). */
export interface DeploymentHistoryEntry {
  id: string;
  version: string;
  status: "deployed" | "paused" | "awaiting_promotion_signoff" | "retired";
  modelVersion: string | null;
  deployedAt: string;
  pausedAt: string | null;
  retiredAt: string | null;
  isCurrent: boolean;
}

/** Result shape of POST /api/deployments/[id]/rollback (mirrors promotion-service.ts#RollbackDeploymentResult). */
export interface RollbackDeploymentResult {
  initiativeId: string;
  fromDeploymentVersionId: string;
  fromVersion: string;
  toDeploymentVersionId: string;
  toVersion: string;
  status: "deployed";
}

/** Result of POST /api/agents/health (mirrors lib/agents/health.ts#ConnectorHealth). */
export interface ConnectorHealth {
  configured: boolean;
  reachable: boolean;
  adapter: "openai" | "mock";
  model: string;
  assetsReady: boolean | null;
  latencyMs?: number;
  detail: string;
}

/* -------------------------------------------------------------------------
 * Core request helper
 * ---------------------------------------------------------------------- */

async function parseErrorBody(res: Response): Promise<{ message: string; gaps?: unknown[]; code?: string }> {
  try {
    const body = (await res.json()) as { error?: unknown; gaps?: unknown[]; code?: unknown };
    const message = typeof body?.error === "string" ? body.error : `request failed (${res.status})`;
    return { message, gaps: Array.isArray(body?.gaps) ? body.gaps : undefined, code: typeof body?.code === "string" ? body.code : undefined };
  } catch {
    return { message: `request failed (${res.status})` };
  }
}

async function request<T>(
  url: string,
  options: { method: "GET" | "POST" | "PUT"; token?: string; body?: unknown },
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
    const { message, gaps, code } = await parseErrorBody(res);
    throw new ApiError(res.status, message, gaps, code);
  }
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------
 * Route helpers (one per app/api/** route)
 * ---------------------------------------------------------------------- */

/** Start a demo or switch personas within the current workspace. */
export function postSession(personaKey: string, token?: string): Promise<SessionResult> {
  return request<SessionResult>("/api/session", {
    method: "POST",
    token,
    body: { personaKey },
  });
}

/** New per-editor creation key; callers retain it for every retry of that draft creation. */
export function createIntakeRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** POST /api/initiatives — requester-only intake draft creation. */
export function createInitiative(
  token: string,
  payload: IntakePayload,
  requestId = createIntakeRequestId(),
): Promise<CreateInitiativeResult> {
  return request<CreateInitiativeResult>("/api/initiatives", {
    method: "POST",
    token,
    body: { payload, requestId },
  });
}

export function getIntakeDraft(token: string, initiativeId: string): Promise<IntakeDraftResult> {
  return request<IntakeDraftResult>(`/api/initiatives/${encodeURIComponent(initiativeId)}/intake`, {
    method: "GET",
    token,
  });
}

export function updateIntakeDraft(
  token: string,
  initiativeId: string,
  payload: IntakePayload,
  expectedVersion: number,
): Promise<IntakeDraftResult> {
  return request<IntakeDraftResult>(`/api/initiatives/${encodeURIComponent(initiativeId)}/intake`, {
    method: "PUT",
    token,
    body: { payload, expectedVersion },
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

/**
 * POST /api/reviews/[cycleId]/[domain]/run — a reviewer runs their domain's
 * drafting agent on demand (budget-gated; invokes the LLM). Reviewer-only and
 * domain-scoped server-side. Returns the fresh draft so the caller can load
 * it straight into the editor.
 */
export function runReviewAgent(
  token: string,
  cycleId: string,
  domain: Domain,
  expectedRevision?: number,
): Promise<RunReviewAgentResult> {
  return request<RunReviewAgentResult>(
    `/api/reviews/${encodeURIComponent(cycleId)}/${encodeURIComponent(domain)}/run`,
    { method: "POST", token, body: expectedRevision === undefined ? undefined : { expectedRevision } },
  );
}

export interface SignReviewInput {
  expectedRevision: number;
  expectedEvidencePacketId: string | null;
  editedDraftMd?: string;
}

/** POST /api/reviews/[cycleId]/[domain]/sign — reviewer-only. */
export function signReview(
  token: string,
  cycleId: string,
  domain: Domain,
  input: SignReviewInput,
): Promise<SignReviewResult> {
  return request<SignReviewResult>(
    `/api/reviews/${encodeURIComponent(cycleId)}/${encodeURIComponent(domain)}/sign`,
    {
      method: "POST",
      token,
      body: input,
    },
  );
}

/** POST /api/reviews/[cycleId]/[domain]/return — reviewer-only, reason required. */
export function returnReview(
  token: string,
  cycleId: string,
  domain: Domain,
  reason: string,
  expectedRevision: number,
): Promise<ReturnReviewResult> {
  return request<ReturnReviewResult>(
    `/api/reviews/${encodeURIComponent(cycleId)}/${encodeURIComponent(domain)}/return`,
    { method: "POST", token, body: { reason, expectedRevision } },
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

/**
 * POST /api/agents/health — live connector probe (the /agents "Test
 * connection" action). Session- and budget-gated; makes one minimal live call
 * only when a key is configured (mock status returned with no call otherwise).
 */
export function testAgentConnection(token: string): Promise<ConnectorHealth> {
  return request<ConnectorHealth>("/api/agents/health", { method: "POST", token });
}

/* --- M4 control-exception workflow (app/api/exceptions/**) --- */

export type ExceptionStatus = "requested" | "approved" | "rejected" | "revoked" | "expired" | "superseded";

/** Mirrors lib/services/exception-service.ts#ExceptionRow (wire shape). */
export interface ExceptionRow {
  id: string;
  controlId: string;
  effectiveControlId: string;
  initiativeId: string | null;
  status: ExceptionStatus;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  expiresAt: number | null;
  supersedesId: string | null;
}

export interface ExceptionActionResult {
  id: string;
  controlId: string;
  status: ExceptionStatus;
  expiresAt: number | null;
}

/** GET /api/exceptions — public read-only list (optionally by status). */
export async function listExceptions(status?: ExceptionStatus): Promise<ExceptionRow[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await request<{ exceptions: ExceptionRow[] }>(`/api/exceptions${q}`, { method: "GET" });
  return result.exceptions;
}

/** POST /api/exceptions/[id]/decide — approver/admin only; never the requester (SoD). */
export function decideException(
  token: string,
  id: string,
  approve: boolean,
  reason: string,
): Promise<ExceptionActionResult> {
  return request<ExceptionActionResult>(`/api/exceptions/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    token,
    body: { approve, reason },
  });
}

/** POST /api/exceptions/[id]/revoke — approver/admin only. */
export function revokeException(token: string, id: string, reason: string): Promise<ExceptionActionResult> {
  return request<ExceptionActionResult>(`/api/exceptions/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    token,
    body: { reason },
  });
}

/** POST /api/exceptions/[id]/renew — opens a new requested exception superseding an approved one. */
export function renewException(token: string, id: string, reason: string): Promise<ExceptionActionResult> {
  return request<ExceptionActionResult>(`/api/exceptions/${encodeURIComponent(id)}/renew`, {
    method: "POST",
    token,
    body: { reason },
  });
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

/** POST /api/deployments/[id]/rollback — approver/admin-only; [id] is the INITIATIVE id. */
export function rollbackDeployment(
  token: string,
  initiativeId: string,
  targetDeploymentVersionId: string,
  reason: string,
): Promise<RollbackDeploymentResult> {
  return request<RollbackDeploymentResult>(
    `/api/deployments/${encodeURIComponent(initiativeId)}/rollback`,
    { method: "POST", token, body: { targetDeploymentVersionId, reason } },
  );
}
