/**
 * POST /api/initiatives/[id]/draft-run — start the domain draft-review
 * fan-out (task brief deliverable 2/3). Invokes the AgentPort per domain,
 * so it is budget-checked via `lib/security/budget` reserve() even though
 * the mock adapter (tests/demo-safe default) costs 0 tokens — this
 * exercises the budget-gate path per the task brief ("reserve anyway").
 *
 * Body:  { domains: Domain[] }
 * 200:   { runId, cycleId, outcomes: DraftRunDomainOutcome[] }
 * 401/429/400/404: as other mutating routes.
 *
 * GET /api/initiatives/[id]/draft-run?cycleId=... — progress polling.
 * Public read-only (no session required, per task brief "GET routes stay
 * public read-only"); requires ?cycleId= since progress is keyed by cycle,
 * not initiative, in `getRunProgress`.
 * 200: { cycleId, rows: DraftRunProgressRow[], complete: boolean }
 * 400: { error: string }  (missing cycleId)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { startDraftRun, getRunProgress } from "@/lib/workflow/review-run";
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

const bodySchema = z.object({
  domains: z.array(z.enum(DOMAINS)).min(1).max(8),
});

/** Rough per-domain token estimate for the budget reserve — the mock adapter costs 0 for real, this only sizes the reservation. */
const ESTIMATED_TOKENS_PER_DOMAIN = 1500;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = bodySchema.safeParse(json);

  const guard = await runMutationGuard(req, undefined, {
    requiresBudget: true,
    estimatedTokens: parsed.success ? parsed.data.domains.length * ESTIMATED_TOKENS_PER_DOMAIN : 0,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  if (!parsed.success) {
    return Response.json({ error: "invalid domains list" }, { status: 400 });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await startDraftRun(db, id, [...parsed.data.domains] as Domain[]);
    return Response.json(result, { status: 200 });
  } catch {
    // Security review finding #6: never echo raw error internals (this
    // catch-all previously leaked any thrown message, incl. DB errors).
    return Response.json({ error: "initiative or review cycle not found" }, { status: 404 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cycleId = url.searchParams.get("cycleId");
  if (!cycleId) {
    return Response.json({ error: "cycleId query param is required" }, { status: 400 });
  }

  const db = getDb();
  const progress = await getRunProgress(db, cycleId);
  return Response.json(progress, { status: 200 });
}
