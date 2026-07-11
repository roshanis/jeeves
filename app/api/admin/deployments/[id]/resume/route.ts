/**
 * POST /api/admin/deployments/[id]/resume — companion to
 * .../pause/route.ts: manual deployment resume (plan.md §2 step 8, §9 P3;
 * task brief deliverable 3). Admin-only + non-empty reason. `[id]` is the
 * INITIATIVE id, same convention as the pause route.
 *
 * `resumeDeployment` accepts both `paused` and `re_review` as valid "before"
 * states (lib/lifecycle/transitions.ts's `resume` rule) — so this same
 * route both un-pauses a manually-paused deployment and closes out a
 * post-breach reassessment once satisfied.
 *
 * Body:  { reason: string }
 * 200:   { initiativeId, deploymentId, before, after }
 * 401/429/400: as other mutating routes (400 also covers an empty reason and
 *        a state violation, e.g. resuming an already-deployed deployment).
 * 403:   { error: string }  (non-admin actor)
 * 404:   { error: string }  (unknown initiative / no deployment)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  resumeDeployment,
  ForbiddenError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/admin-service";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const bodyText: Record<string, string> = {
    reason: typeof (json as { reason?: unknown })?.reason === "string" ? (json as { reason: string }).reason : "",
  };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "reason", maxChars: 2000 }],
    inputTotalCap: 2000,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await resumeDeployment(db, guard.actor, id, parsed.data.reason);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
