/**
 * POST /api/initiatives/[id]/decide — approver-only initiative-level
 * decision (task brief deliverable 3). SoD is enforced inside `decide()`
 * via `transition()` (only role `approver` may approve/conditionally
 * approve/reject); non-approver callers get `IllegalTransitionError`,
 * mapped to 403 here.
 *
 * Body:  { decision: "approved" | "conditionally_approved" | "rejected",
 *          conditions?: { text: string, controlId: string }[],
 *          citations?: string[] }
 * 200:   { initiativeId, decisionId, type, after: LifecycleState }
 * 401/429: as other mutating routes.
 * 400:   { error: string }  (invalid body, e.g. conditionally_approved with no conditions)
 * 403:   { error: string }  (non-approver actor)
 * 404:   { error: string }  (unknown initiative id)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { IllegalTransitionError, NotFoundError, ValidationError, decide } from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  decision: z.enum(["approved", "conditionally_approved", "rejected"]),
  conditions: z.array(z.object({ text: z.string().max(1000), controlId: z.string().max(50) })).optional(),
  citations: z.array(z.string().max(200)).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await decide(db, id, guard.actor, parsed.data);
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
