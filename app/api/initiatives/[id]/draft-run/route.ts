/** Draft review commands reserve estimated capacity only after authorization and a database claim. */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { draftBudgetPolicy } from "@/lib/workflow/draft-execution-policy";
import { resolveAgentRuntimeConfig, reviewInvocationLimits } from "@/lib/agents/runtime";
import { ReviewIntegrityError } from "@/lib/services/review-integrity";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { initiatives, reviewCycles } from "@/lib/db/schema";
import { startDraftRun, getRunProgress } from "@/lib/workflow/review-run";
import { runMutationGuard } from "@/lib/services/route-guard";
import { workspaceMismatch } from "@/lib/services/workspace-guard";
import { resolveViewerWorkspaceId } from "@/lib/services/viewer-workspace";
import type { Domain } from "@/lib/domain/types";
import { agentInitializationResponse } from "@/lib/services/agent-error-response";

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

  const guard = await runMutationGuard(req, undefined);
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

  const limits = reviewInvocationLimits(resolveAgentRuntimeConfig());
  try {
    const result = await startDraftRun(db, id, [...parsed.data.domains] as Domain[], undefined, {
      actor: guard.actor, sessionWorkspaceId: guard.workspaceId, budget: draftBudgetPolicy(), signal: req.signal,
      runTimeoutMs: limits.timeoutMs,
    });
    if (result.outcomes.every((outcome) => outcome.error?.kind === "budget-exhausted")) {
      return Response.json({ ...result, error: "Demo token reservation budget exhausted for today." }, { status: 429 });
    }
    return Response.json(result, { status: 200 });
  } catch (error) {
    const unavailable = agentInitializationResponse(error);
    if (unavailable) return unavailable;
    if (error instanceof ReviewIntegrityError) {
      return Response.json({ error: error.message }, { status: error.kind === "not_found" ? 404 : 409 });
    }
    return Response.json({ error: "Draft execution could not be completed. Refresh its status before retrying.", requestId: randomUUID() }, { status: 500 });
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
      // Preserve identical results for unknown and foreign-workspace cycles.
      return Response.json({ cycleId, rows: [], complete: false }, { status: 200 });
    }
  }

  const progress = await getRunProgress(db, cycleId);
  return Response.json(progress, { status: 200 });
}
