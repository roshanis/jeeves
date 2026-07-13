/**
 * POST /api/deployments/[id]/rollback — approver/admin-only deployment
 * rollback (M3 promotion-view extension). `[id]` is the INITIATIVE id
 * (matches `app/api/admin/deployments/[id]/pause|resume/route.ts`'s
 * convention, NOT `app/api/deployments/promotions/[id]/promote/route.ts`'s
 * convention of a deployment-version id — rollback is scoped to "this
 * initiative's live deployment", and the target prior version is named
 * explicitly in the body).
 *
 * Role-gating (approver OR admin) happens in the SERVICE layer
 * (`rollbackDeployment` throws `ForbiddenError` for any other actor role),
 * mirroring `promoteCheckpoint`'s and `pauseDeployment`'s pattern:
 * `runMutationGuard` only handles session/rate-limit/input-size here; the
 * role check runs after, inside the service call, and its error is mapped
 * to 403 below.
 *
 * `requiresBudget` is NOT set — this action never invokes an LLM/agent, it
 * only flips DB rows and writes an audit event.
 *
 * Body:  { targetDeploymentVersionId: string, reason: string }
 * 200:   RollbackDeploymentResult
 * 401/429: as other mutating routes.
 * 400:   { error: string }  (malformed body; empty reason; the initiative has
 *        no currently-deployed version; the target isn't a prior
 *        retired/paused version of THIS initiative; or the target is already
 *        the current deployed version.)
 * 403:   { error: string }  (non-approver, non-admin actor — SoD)
 * 404:   { error: string }  (unknown initiative id or unknown target
 *        deployment version id)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  rollbackDeployment,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/promotion-service";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  targetDeploymentVersionId: z.string().min(1).max(200),
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

  const body = json as { targetDeploymentVersionId?: unknown; reason?: unknown };
  const bodyText: Record<string, string> = {
    targetDeploymentVersionId:
      typeof body?.targetDeploymentVersionId === "string" ? body.targetDeploymentVersionId : "",
    reason: typeof body?.reason === "string" ? body.reason : "",
  };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [
      { field: "targetDeploymentVersionId", maxChars: 200 },
      { field: "reason", maxChars: 2000 },
    ],
    inputTotalCap: 2200,
    requiresBudget: false,
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
    const result = await rollbackDeployment(
      db,
      id,
      guard.actor,
      parsed.data.targetDeploymentVersionId,
      parsed.data.reason,
    );
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message, issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
