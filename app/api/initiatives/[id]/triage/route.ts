/**
 * POST /api/initiatives/[id]/triage — deterministic triage (task brief
 * deliverable 3). Any authenticated demo persona may trigger it (it's a
 * deterministic system computation, not a human judgment call — matching
 * `lib/lifecycle/transitions.ts`'s `triage` rule, which only permits actor
 * role `system`); the service always records the `system` actor on the
 * resulting audit event/transition regardless of which persona clicked
 * "Run triage", so no role check gates this route beyond "has a session".
 *
 * Body:  (none)
 * 200:   TriageFastLaneResult | TriageReviewResult (see initiative-service.ts)
 * 401/429/404: as other mutating routes.
 */
import { getDb } from "@/lib/db/client";
import { NotFoundError, triage } from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await triage(db, id);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
