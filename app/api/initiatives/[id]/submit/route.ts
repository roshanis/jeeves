/**
 * POST /api/initiatives/[id]/submit — submit the current intake version
 * (task brief deliverable 3). Runs `evaluateCompleteness`; BLOCKING gaps
 * prevent submission (200 with `submitted: false` + gap list, not an
 * error — this is an expected/normal outcome, not a failure of the route).
 *
 * Auth: session required, role `requester`, and the acting requester must
 * OWN the initiative (`submitIntake` enforces this and throws
 * `IllegalTransitionError` otherwise, mapped to 403 here).
 * Body:  (none)
 * 200:   { submitted: true, completenessPct: number }
 *      | { submitted: false, gaps: CompletenessGap[] }
 * 401/429: as other mutating routes.
 * 403:   { error: string }  (non-requester actor, or requester does not own the initiative)
 * 404:   { error: string }  (unknown initiative id)
 */
import { getDb } from "@/lib/db/client";
import { IllegalTransitionError, NotFoundError, submitIntake } from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }
  if (guard.actor.role !== "requester") {
    return Response.json({ error: "only requesters may submit an intake" }, { status: 403 });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await submitIntake(db, id, guard.actor);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
