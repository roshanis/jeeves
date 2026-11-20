/**
 * POST /api/chat/auditor — natural-language audit Q&A chat (M2 — plan.md §13
 * Breadth; agents/auditor/instructions.md). Session-gated for ANY persona
 * (an auditor question is a read/explain action, not a role-restricted
 * mutation — unlike e.g. POST /api/admin/threshold, which additionally
 * checks `actor.role !== "admin"` after the guard). Budget-reserved since
 * this invokes the AgentPort, mirroring
 * app/api/initiatives/[id]/draft-run/route.ts's "reserve anyway even though
 * the mock adapter costs 0 tokens" rationale.
 *
 * Grounding happens server-side, BEFORE the agent is ever called
 * (agents/auditor/instructions.md "What you will receive": the app layer
 * decides which query to run and hands the agent only those rows — the
 * agent never chooses or runs a query itself). See `pickCannedQuery` below
 * for the keyword heuristic.
 *
 * Body:  { question: string }
 * 200:   { answerMd: string, citedEvents: string[], queryUsed: string, rows: unknown[] }
 * 401:   { error: string }  (no/invalid session)
 * 429:   { error: string }  (rate limit or daily model budget reached)
 * 400:   { error: string }  (malformed body / input-size cap exceeded)
 * 502:   { error: string }  (PortFailure kind "provider")
 * 504:   { error: string }  (PortFailure kind "timeout")
 * 499:   { error: string }  (PortFailure kind "cancelled" — non-standard but
 *        widely used for "client closed request"; chosen over 500 because
 *        this path is never a genuine server bug, see judgment-call note
 *        below)
 */
import { z } from "zod";
import { getAgentPort } from "@/lib/agents";
import type { AgentPort, PortFailure } from "@/lib/agents/ports";
import { agentInitializationResponse, llmNotConfigured, llmNotConfiguredResponse } from "@/lib/services/agent-error-response";
import { getProvider } from "@/lib/data";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { guardFailureResponse, reserveDailyBudget, runMutationGuard } from "@/lib/services/route-guard";
import { databaseNotReady } from "@/lib/http/database-gate";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
});

const QUESTION_MAX_CHARS = 2000;
/** Headroom for the system prompt and completion; the grounding text is added on top when reserving. */
const BASE_ESTIMATED_TOKENS = 600;
/** Grounding sent to the model is bounded so a caller cannot inflate real spend past the reservation. */
const MAX_GROUNDING_ROWS = 50;
const MAX_GROUNDING_FIELD_CHARS = 500;
const MAX_SLUG_CANDIDATES = 5;
const AGENT_TIMEOUT_MS = 10_000;

// A full ISO 8601 date-time with a zone, as the audit rows carry it. Date.parse
// on its own is too lenient for a citation: it reads "42", a bare year and a
// bare date as dates.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
function isoInstant(text: string): number | null {
  if (!ISO_DATE_TIME.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Deterministic keyword-scoring heuristic to pick the best canned query
 * (`lib/data/dto.ts`'s `CannedAuditQueryId`) for a free-form question.
 * Each candidate query has a small set of trigger keywords; the query with
 * the most keyword hits (ties broken by declaration order below) wins.
 * Falls back to "member-facing-phi" when nothing scores above zero — an
 * arbitrary-but-documented default rather than guessing at a structured-read
 * fallback for every unmatched phrasing (a genuinely initiative-specific
 * question, e.g. naming a slug/title outside all four canned queries, is the
 * one case this route falls through to the structured-read path below
 * instead of a canned query).
 */
const QUERY_KEYWORDS: { id: CannedAuditQueryId; keywords: string[] }[] = [
  { id: "member-facing-phi", keywords: ["member-facing", "member facing", "phi", "member"] },
  { id: "approved-by-torres", keywords: ["torres", "approved by", "approval", "approve"] },
  { id: "overdue-controls", keywords: ["overdue", "late", "past due", "remediation"] },
  { id: "q01-control-changes", keywords: ["q-01", "q01", "threshold", "control change", "changed"] },
];

function scoreQuery(question: string, keywords: string[]): number {
  const normalized = question.toLowerCase();
  return keywords.reduce((score, kw) => (normalized.includes(kw) ? score + 1 : score), 0);
}

/**
 * Caps the grounding set by row count and per-field size (long strings and
 * serialized nested values are truncated) before it reaches the model.
 * Rows ordered oldest first (an initiative's events) keep their newest
 * entries; other rows keep the first ones.
 */
function boundGroundingRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  keepNewest = false,
): Readonly<Record<string, unknown>>[] {
  const kept = keepNewest ? rows.slice(-MAX_GROUNDING_ROWS) : rows.slice(0, MAX_GROUNDING_ROWS);
  return kept.map((row) => {
    const bounded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const text = typeof value === "string" ? value : value !== null && typeof value === "object" ? JSON.stringify(value) : null;
      bounded[key] =
        text !== null && text.length > MAX_GROUNDING_FIELD_CHARS ? text.slice(0, MAX_GROUNDING_FIELD_CHARS) : value;
    }
    return bounded;
  });
}

/** Three or more segments: an ordinary hyphenated word ("re-review") is not reported as an unknown initiative. */
function isSlugLike(token: string): boolean {
  return token.split("-").length >= 3;
}

/** Kebab-case tokens in the question that might name an initiative slug (live slugs carry a hex suffix). */
function slugCandidates(question: string): string[] {
  const matches = question.toLowerCase().match(/\b[a-z0-9]+(?:-[a-z0-9]+){1,8}\b/g) ?? [];
  return [...new Set(matches)].slice(0, MAX_SLUG_CANDIDATES);
}

/**
 * Picks the canned query id the keyword heuristic prefers, or the documented
 * default. Initiative references are resolved before this (see POST).
 */
function pickCannedQuery(question: string): CannedAuditQueryId {
  let bestId: CannedAuditQueryId | null = null;
  let bestScore = 0;
  for (const candidate of QUERY_KEYWORDS) {
    const score = scoreQuery(question, candidate.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }
  return bestId ?? "member-facing-phi";
}

function statusForFailure(error: PortFailure): number {
  switch (error.kind) {
    case "validation":
      return 400;
    case "provider":
      return 502;
    case "timeout":
      return 504;
    case "cancelled":
      // Judgment call: 499 ("client closed request", nginx convention, not
      // in the official IANA registry) is chosen over a generic 500 because
      // a cancelled invocation is never a server-side bug — it reflects a
      // caller-initiated abort (explicit AbortSignal). Documented here since
      // 499 is non-standard.
      return 499;
    case "budget-exhausted":
      // Should not occur here (budget is already reserved by
      // runMutationGuard before the agent is ever called) — handled
      // defensively per the task brief.
      return 429;
  }
}

export async function POST(req: Request): Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  // A production install with no LLM has nothing to answer with. The guard
  // still authenticates first (an anonymous caller gets its 401); the 503
  // follows once the caller is accepted, before any budget is reserved.
  const noLlm = llmNotConfigured();

  const guard = await runMutationGuard(req, (json) => {
    const bodyText: Record<string, string> = {
      question: typeof (json as { question?: unknown })?.question === "string"
        ? (json as { question: string }).question
        : "",
    };
    return bodyText;
  }, {
    inputLimits: [{ field: "question", maxChars: QUESTION_MAX_CHARS }],
    inputTotalCap: QUESTION_MAX_CHARS,
  });
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }
  const json = guard.json;

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  // Refuse before the grounding queries below: there is no provider to answer.
  if (noLlm) return llmNotConfiguredResponse();

  const provider = getProvider();

  let rows: readonly Readonly<Record<string, unknown>>[];
  let queryUsed: string;
  let keepNewest = false;

  // Ground only on rows the caller's workspace may see (external-review
  // finding #2): seeded/shared rows plus the session's own workspace — never
  // the whole portfolio.
  const scope = { viewerWorkspaceId: guard.workspaceId };

  // A question that names one of the viewer's initiatives is grounded on that
  // initiative's own audit history, ahead of the keyword heuristic.
  const candidates = slugCandidates(parsed.data.question);
  let detail: Awaited<ReturnType<typeof provider.getInitiativeDetail>> = null;
  for (const candidate of candidates) {
    detail = await provider.getInitiativeDetail(candidate, scope);
    if (detail) break;
  }

  if (detail) {
    rows = detail.events as unknown as Readonly<Record<string, unknown>>[];
    queryUsed = `initiative-events:${detail.summary.slug}`;
    keepNewest = true;
  } else {
    const normalized = parsed.data.question.toLowerCase();
    const canned = QUERY_KEYWORDS.some((q) => scoreQuery(normalized, q.keywords) > 0);
    const unknownSlug = candidates.find(isSlugLike);
    if (!canned && unknownSlug) {
      // The question names something slug-shaped (three or more segments)
      // that is not a visible initiative: say so rather than grounding on an
      // unrelated query. An ordinary hyphenated word such as "re-review"
      // takes the canned-query path instead.
      rows = [];
      queryUsed = `initiative-not-found:${unknownSlug}`;
    } else {
      const id = pickCannedQuery(parsed.data.question);
      const auditRows: AuditQueryRow[] = await provider.auditQuery(id, scope);
      rows = auditRows as unknown as Readonly<Record<string, unknown>>[];
      queryUsed = id;
    }
  }

  rows = boundGroundingRows(rows, keepNewest);

  // Reserve from what is actually sent to the model, after grounding.
  const budget = await reserveDailyBudget(
    BASE_ESTIMATED_TOKENS + Math.ceil((parsed.data.question.length + JSON.stringify(rows).length) / 4),
  );
  if (budget) return Response.json({ error: budget.message }, { status: budget.status });

  let port: AgentPort;
  try {
    port = getAgentPort();
  } catch (error) {
    const unavailable = agentInitializationResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
  const result = await port.auditorAnswer(
    { question: parsed.data.question, groundingRows: rows, queryUsed },
    { signal: req.signal, timeoutMs: AGENT_TIMEOUT_MS },
  );

  if (!result.ok) {
    const message = "message" in result.error ? result.error.message : result.error.kind;
    return Response.json({ error: message }, { status: statusForFailure(result.error) });
  }

  // Citations the model returns are shown as evidence: keep only labels that
  // exist in the grounding rows (timestamps, ids, or the row-N fallback label).
  // A timestamp also matches by instant, so a different ISO spelling of a real
  // row timestamp (no milliseconds, +00:00 offset) still counts; it is shown
  // once, in the row's own spelling. Everything else is dropped.
  const known = new Set<string>(rows.map((_, i) => `row-${i}`));
  const rowSpelling = new Map<number, string>();
  for (const row of rows) {
    for (const key of ["eventTs", "ts", "id"]) {
      const value = row[key];
      if (typeof value !== "string" || value.length === 0) continue;
      known.add(value);
      const instant = key === "id" ? null : isoInstant(value);
      if (instant !== null && !rowSpelling.has(instant)) rowSpelling.set(instant, value);
    }
  }
  const grounded = (citation: string): string | null => {
    if (known.has(citation)) return citation;
    const instant = isoInstant(citation);
    return instant === null ? null : rowSpelling.get(instant) ?? null;
  };
  const citedEvents = [
    ...new Set(result.value.citedEvents.map(grounded).filter((c): c is string => c !== null)),
  ].slice(0, MAX_GROUNDING_ROWS);

  return Response.json(
    {
      answerMd: result.value.answerMd,
      citedEvents,
      queryUsed: result.value.queryUsed,
      rows,
    },
    { status: 200 },
  );
}
