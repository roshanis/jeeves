/**
 * POST /api/initiatives/[id]/qc-return — fail QC, return to the requester.
 *
 * Sends the intake back to `intake_draft` so the requester can edit and
 * resubmit, with the reason on the append-only audit trail. The reason is
 * required: a bare return tells the requester nothing, which is how an
 * intake ends up bouncing between them and QC.
 *
 * No review rows exist at this point — triage has not run — so there is
 * nothing to unwind. That is exactly why the gate sits before the fan-out.
 *
 * Body:  { reason: string }
 * 200:   { state: "intake_draft", reason: string }
 * 400:   { error }  (missing reason, wrong state, or persona may not return)
 * 401/429/404: as other mutating routes.
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  returnFromQc,
} from "@/lib/services/initiative-service";
import { IllegalTransitionError } from "@/lib/lifecycle/transitions";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({ reason: z.string().min(1).max(2000) });

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "a QC return requires a reason" }, { status: 400 });
  }

  // Input-size caps applied through the shared guard, same as other
  // reason-carrying mutations.
  const guard = await runMutationGuard(req, { reason: parsed.data.reason }, {
    inputLimits: [{ field: "reason", maxChars: 2000 }],
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const { id } = await context.params;

  try {
    const result = await returnFromQc(getDb(), id, guard.actor, parsed.data.reason, guard.workspaceId);
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
