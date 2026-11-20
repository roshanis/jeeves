/**
 * POST /api/initiatives/[id]/decide — approver-only initiative-level
 * decision (task brief deliverable 3). SoD is enforced inside `decide()`
 * via `transition()` (only role `approver` may approve/conditionally
 * approve/reject); non-approver callers get `IllegalTransitionError`,
 * mapped to 403 here.
 *
 * Body:  { decision: "approved" | "conditionally_approved" | "rejected",
 *          conditions?: { text: string, controlId: string }[],
 *          citations?: string[],
 *          reason?: string }   required (1 to 2,000 characters) when rejecting;
 *                              ignored for the other decisions
 * 200:   { initiativeId, decisionId, type, after: LifecycleState }
 * 401/429: as other mutating routes.
 * 400:   { error: string }  (invalid body, e.g. conditionally_approved with no conditions,
 *                            or a rejection with no reason)
 * 403:   { error: string }  (non-approver actor)
 * 404:   { error: string }  (unknown initiative id)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
  decide,
} from "@/lib/services/initiative-service";
import { guardFailureResponse, runMutationGuard } from "@/lib/services/route-guard";
import { isRouteId, notFoundResponse } from "@/lib/http/route-id";
import { databaseNotReady } from "@/lib/http/database-gate";

const bodySchema = z.object({
  decision: z.enum(["approved", "conditionally_approved", "rejected"]),
  conditions: z.array(z.object({ text: z.string().trim().min(1).max(1000), controlId: z.string().trim().min(1).max(50) })).max(20).optional(),
  citations: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  // Length is checked in decide(), which names the field in its 400.
  reason: z.string().optional(),
  expectedCycleId: z.string().max(100).optional(),
  expectedReviewRevisions: z.record(z.string().max(50), z.number().int().min(0)).refine((m) => Object.keys(m).length <= 20).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  const guard = await runMutationGuard(req, () => undefined);
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }

  const parsed = bodySchema.safeParse(guard.json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { id } = await context.params;
  if (!isRouteId(id)) return notFoundResponse();
  const db = getDb();

  try {
    const result = await decide(db, id, guard.actor, guard.workspaceId, parsed.data);
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
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
