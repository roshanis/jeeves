/**
 * POST /api/initiatives/[id]/draft-run — start the domain draft-review
 * fan-out (task brief deliverable 2/3). Invokes the AgentPort per domain,
 * so it is budget-checked via `lib/security/budget` reserve() even though
 * the mock adapter (tests/demo-safe default) costs 0 tokens — this
 * exercises the budget-gate path per the task brief ("reserve anyway").
 *
 * Security-hardening pass (external-review finding #6, partial — "draft-run
 * has weak authorization"): this route used to accept ANY authenticated
 * persona. Evidence for the allowed-role set below: tests/e2e/golden-path.spec.ts
 * (the only place the app actually triggers this endpoint end-to-end) logs
 * in as the REQUESTER persona ("priya-raman") and drives create -> submit ->
 * triage -> draft-run all in that one session — components/jeeves/reviews-tab.tsx's
 * "Start draft run" panel renders for whichever live session created the
 * initiative (no separate in-component role gate), matching the champion
 * storyline where the requester kicks off the review fan-out right after
 * triage, distinct from a reviewer's own per-domain "Run agent" button
 * (POST /api/reviews/[cycleId]/[domain]/run, gated to that reviewer's
 * assigned domain already). Allowed set: `requester` (the only role any
 * real flow uses to trigger this) + `admin` (operational override, matching
 * this codebase's convention elsewhere of admin having operational reach
 * without approval authority). Every other role — including reviewer/
 * approver/program, who have no legitimate reason to kick off another
 * initiative's fan-out — is rejected with 403.
 *
 * Also now enforces workspace authorization (finding #1): the initiative is
 * loaded and its `workspaceId` compared to the session's before doing
 * anything else — a cross-workspace id 404s exactly like an unknown one.
 *
 * Body:  { domains: Domain[] }
 * 200:   { runId, cycleId, outcomes: DraftRunDomainOutcome[] }
 * 401/403/429/400/404: as other mutating routes.
 *
 * GET /api/initiatives/[id]/draft-run?cycleId=... — progress polling.
 * Public read-only (no session required, per task brief "GET routes stay
 * public read-only"); requires ?cycleId= since progress is keyed by cycle,
 * not initiative, in `getRunProgress`.
 *
 * Read isolation (P0 pass, external-review finding 2): the cycle's owning
 * initiative is resolved and checked against the viewer (session, else
 * signed `jeeves_workspace` cookie, else anonymous/seeded-only) BEFORE
 * calling `getRunProgress` — a cycle belonging to a foreign workspace
 * returns the EXACT same shape/status `getRunProgress` itself returns for
 * an unknown cycleId (`{ cycleId, rows: [], complete: true }`, 200), so
 * there is no existence leak distinguishing "wrong workspace" from
 * "unknown id".
 * 200: { cycleId, rows: DraftRunProgressRow[], complete: boolean }
 * 400: { error: string }  (missing cycleId)
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { initiatives, reviewCycles } from "@/lib/db/schema";
import { startDraftRun, getRunProgress } from "@/lib/workflow/review-run";
import { runMutationGuard } from "@/lib/services/route-guard";
import { workspaceMismatch } from "@/lib/services/workspace-guard";
import { resolveViewerWorkspaceId } from "@/lib/services/viewer-workspace";
import type { Domain } from "@/lib/domain/types";

/** See file-level comment: only these roles trigger draft-run in any real flow. */
const DRAFT_RUN_ALLOWED_ROLES = new Set(["requester", "admin"]);

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

  // Finding #6 (partial): role restriction — see file-level comment for the
  // evidence behind this allowed set.
  if (!DRAFT_RUN_ALLOWED_ROLES.has(guard.actor.role)) {
    return Response.json({ error: "role not permitted to start a draft run" }, { status: 403 });
  }

  if (!parsed.success) {
    return Response.json({ error: "invalid domains list" }, { status: 400 });
  }

  const { id } = await context.params;
  const db = getDb();

  // Finding #1: workspace authorization — load the initiative first so a
  // cross-workspace id 404s the same way an unknown one does, before any
  // agent/budget work happens against it.
  const [initiative] = await db
    .select({ workspaceId: initiatives.workspaceId })
    .from(initiatives)
    .where(eq(initiatives.id, id));
  if (!initiative || workspaceMismatch(initiative.workspaceId, guard.workspaceId)) {
    return Response.json({ error: "initiative or review cycle not found" }, { status: 404 });
  }

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
  const viewerWorkspaceId = await resolveViewerWorkspaceId(req);

  const [cycle] = await db
    .select({ initiativeId: reviewCycles.initiativeId })
    .from(reviewCycles)
    .where(eq(reviewCycles.id, cycleId));
  if (cycle) {
    const [initiative] = await db
      .select({ workspaceId: initiatives.workspaceId })
      .from(initiatives)
      .where(eq(initiatives.id, cycle.initiativeId));
    if (initiative && workspaceMismatch(initiative.workspaceId, viewerWorkspaceId)) {
      // No existence leak: identical shape/status to an unknown cycleId
      // (see getRunProgress — an empty reviewDecisions match vacuously
      // produces rows: [], complete: true).
      return Response.json({ cycleId, rows: [], complete: true }, { status: 200 });
    }
  }

  const progress = await getRunProgress(db, cycleId);
  return Response.json(progress, { status: 200 });
}
