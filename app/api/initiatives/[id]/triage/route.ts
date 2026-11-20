/**
 * POST /api/initiatives/[id]/triage — pass QC and run deterministic triage.
 * Triage itself is a deterministic system computation (matching
 * `lib/lifecycle/transitions.ts`'s `triage` rule, which only permits actor
 * role `system`), so the transition keeps the `system` actor. Choosing to
 * pass QC, though, is the human decision (the alternative being
 * `qc-return`), so only Program Office and Admin may call this route (403
 * otherwise), and the session's actor is recorded as a `qc_passed` audit
 * event in the same transaction via `triage()`'s `passedBy` argument.
 * `SYSTEM_ACTOR` is passed explicitly (rather than relying on `triage()`'s
 * default) so the workspace guard below can be passed positionally after it.
 *
 * Workspace authorization (external-review finding P2-4): the session's
 * bound workspace (from `runMutationGuard`) is passed through to `triage()`,
 * which throws `NotFoundError` — mapped to 404 here, same shape as an
 * unknown id — when the initiative belongs to a different workspace.
 *
 * Body:  (none)
 * 200:   TriageFastLaneResult | TriageReviewResult (see initiative-service.ts)
 * 401/429/404: as other mutating routes.
 * 403:   { error }  (the persona may not pass QC)
 * 409:   { error: string }  (concurrent triage()/submitIntake() raced this initiative — retry; or not in QC, e.g. already triaged)
 * 400:   { error: string }  (initiative has no intake to triage)
 * 400:   { error, code: "INTAKE_TIER_GAPS", gaps: [{ruleId, level, field, message}] }
 *        (a REQUIRED_FOR_TIER intake gap is open: QC cannot pass, the initiative
 *        stays in_qc and nothing is written; return it to the requester.
 *        400 rather than submit's 200 {submitted:false}: the client treats any
 *        2xx as a TriageResult, and refused state changes that carry a reason
 *        map ValidationError to 400 across the routes, as decide and promote do.)
 */
import { getDb } from "@/lib/db/client";
import { ConflictError, IntakeTierGapsError, NotFoundError, ValidationError, triage } from "@/lib/services/initiative-service";
import { IllegalTransitionError } from "@/lib/lifecycle/transitions";
import { guardFailureResponse, runMutationGuard } from "@/lib/services/route-guard";
import { isRouteId, notFoundResponse } from "@/lib/http/route-id";
import { SYSTEM_ACTOR } from "@/lib/services/actors";
import { databaseNotReady } from "@/lib/http/database-gate";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }

  if (guard.actor.role !== "program" && guard.actor.role !== "admin") {
    return Response.json({ error: "only the Program Office or an Admin can pass QC" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isRouteId(id)) return notFoundResponse();
  const db = getDb();

  try {
    const result = await triage(db, id, SYSTEM_ACTOR, guard.workspaceId, guard.actor);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof IntakeTierGapsError) {
      return Response.json({ error: err.message, code: err.code, gaps: err.gaps }, { status: 400 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
