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
 * 429:   { error: string }  (rate limit or demo token budget exhausted)
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
import type { PortFailure } from "@/lib/agents/ports";
import { getProvider } from "@/lib/data";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
});

const QUESTION_MAX_CHARS = 2000;
/** Rough token estimate for one auditor turn — sizes the budget reservation only. */
const ESTIMATED_TOKENS = 800;
const AGENT_TIMEOUT_MS = 10_000;

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
 * Picks a canned query id and a short slug (when the question names one) for
 * the structured-read fallback. Returns `{ kind: "canned", id }` when a
 * canned query scores above zero, else `{ kind: "slug", slug }` when the
 * question contains what looks like a kebab-case initiative slug (so the
 * route can fall back to `getProvider().getInitiativeDetail(slug)` and use
 * its `events` as grounding), else `{ kind: "canned", id: "member-facing-phi" }`
 * as the documented default.
 */
function pickGroundingStrategy(
  question: string,
): { kind: "canned"; id: CannedAuditQueryId } | { kind: "slug"; slug: string } {
  let bestId: CannedAuditQueryId | null = null;
  let bestScore = 0;
  for (const candidate of QUERY_KEYWORDS) {
    const score = scoreQuery(question, candidate.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }
  if (bestId) return { kind: "canned", id: bestId };

  // No canned query matched — look for a kebab-case slug-shaped token (e.g.
  // "member-chat-copilot") the question might be naming directly.
  const slugMatch = question.match(/\b[a-z]+(?:-[a-z]+){1,5}\b/);
  if (slugMatch) return { kind: "slug", slug: slugMatch[0] };

  return { kind: "canned", id: "member-facing-phi" };
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
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const bodyText: Record<string, string> = {
    question: typeof (json as { question?: unknown })?.question === "string"
      ? (json as { question: string }).question
      : "",
  };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "question", maxChars: QUESTION_MAX_CHARS }],
    inputTotalCap: QUESTION_MAX_CHARS,
    requiresBudget: true,
    estimatedTokens: ESTIMATED_TOKENS,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const provider = getProvider();
  const strategy = pickGroundingStrategy(parsed.data.question);

  let rows: readonly Readonly<Record<string, unknown>>[];
  let queryUsed: string;

  if (strategy.kind === "canned") {
    const auditRows: AuditQueryRow[] = await provider.auditQuery(strategy.id);
    rows = auditRows as unknown as Readonly<Record<string, unknown>>[];
    queryUsed = strategy.id;
  } else {
    // Structured-read fallback: the question appears to name a specific
    // initiative not necessarily covered well by a canned query — ground on
    // that initiative's own audit event history instead.
    const detail = await provider.getInitiativeDetail(strategy.slug);
    if (detail) {
      rows = detail.events as unknown as Readonly<Record<string, unknown>>[];
      queryUsed = `initiative-events:${strategy.slug}`;
    } else {
      // The "slug" we matched wasn't a real initiative — fall back to the
      // documented default canned query rather than returning an empty
      // grounding set for a plausible-looking but wrong guess.
      const auditRows: AuditQueryRow[] = await provider.auditQuery("member-facing-phi");
      rows = auditRows as unknown as Readonly<Record<string, unknown>>[];
      queryUsed = "member-facing-phi";
    }
  }

  const port = getAgentPort();
  const result = await port.auditorAnswer(
    { question: parsed.data.question, groundingRows: rows, queryUsed },
    { timeoutMs: AGENT_TIMEOUT_MS },
  );

  if (!result.ok) {
    const message = "message" in result.error ? result.error.message : result.error.kind;
    return Response.json({ error: message }, { status: statusForFailure(result.error) });
  }

  return Response.json(
    {
      answerMd: result.value.answerMd,
      citedEvents: result.value.citedEvents,
      queryUsed: result.value.queryUsed,
      rows,
    },
    { status: 200 },
  );
}
