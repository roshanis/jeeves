/**
 * POST /api/initiatives/[id]/qc — open QC on a submitted intake.
 *
 * The QC gate. `triage()` asks every required domain at once, so a
 * half-complete intake could otherwise spend eight reviewers' time before
 * anyone read it. `submitted --triage-->` was removed from the transition
 * table, making this the only route forward.
 *
 * Unlike the triage route — which passes SYSTEM_ACTOR because triage is a
 * deterministic computation rather than a judgment — this resolves the
 * SESSION's actor. Opening QC is a human judgment restricted to Program
 * Office and Admin, and recording `system` here would make the gate look
 * self-opening on the audit trail.
 *
 * Body:  (none)
 * 200:   { state: "in_qc", completenessPct: number }
 * 400:   { error }  (wrong state, or the persona may not open QC)
 * 401/429/404: as other mutating routes.
 */
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  startQc,
} from "@/lib/services/initiative-service";
import { IllegalTransitionError } from "@/lib/lifecycle/transitions";
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

  try {
    const result = await startQc(getDb(), id, guard.actor, guard.workspaceId);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof IllegalTransitionError || err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
