/**
 * POST /api/reviews/[cycleId]/[domain]/run — a reviewer runs the drafting
 * agent for THEIR domain on demand (M3 operate loop; the workbench "Run
 * agent" button). Reviewer-role only AND only for the reviewer's assigned
 * domain — `runReviewAgent` enforces both (throws `IllegalTransitionError`,
 * mapped to 403 here), refuses to re-draft an already-`signed` review
 * (`ValidationError` -> 400), and 404s an unknown (cycle, domain) pair.
 *
 * This route INVOKES the AgentPort (a real LLM call when OPENAI_API_KEY is
 * set), so it is budget-gated via `runMutationGuard({ requiresBudget })` —
 * exactly like the fan-out draft-run route. A public visitor (no session)
 * gets 401 with no side effects.
 *
 * 200: { cycleId, domain, status: "drafted" | "failed", draftMd?, error? }
 * 401/429: no/invalid session, rate limit, or budget exhausted.
 * 400: unknown domain, or the review is already signed.
 * 403: non-reviewer actor, or reviewer not assigned to this domain.
 * 404: unknown cycle/domain pair.
 */
import { getDb } from "@/lib/db/client";
import {
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
  runReviewAgent,
} from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";
import type { Domain } from "@/lib/domain/types";

const DOMAINS = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
] as const;

/** Rough per-run token estimate for the budget reserve (mock adapter costs 0; this only sizes the reservation). */
const ESTIMATED_TOKENS = 1500;

export async function POST(
  req: Request,
  context: { params: Promise<{ cycleId: string; domain: string }> },
): Promise<Response> {
  // Guard first (session -> rate-limit -> budget) so an unauthenticated
  // caller gets 401 with no side effects, before any domain/authz check.
  const guard = await runMutationGuard(req, undefined, {
    requiresBudget: true,
    estimatedTokens: ESTIMATED_TOKENS,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const { cycleId, domain } = await context.params;
  if (!(DOMAINS as readonly string[]).includes(domain)) {
    return Response.json({ error: "unknown domain" }, { status: 400 });
  }

  const db = getDb();
  try {
    const result = await runReviewAgent(db, cycleId, domain as Domain, guard.actor);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
