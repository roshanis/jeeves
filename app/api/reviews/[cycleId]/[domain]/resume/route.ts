import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
  resumeReview,
} from "@/lib/services/initiative-service";
import { guardFailureResponse, runMutationGuard } from "@/lib/services/route-guard";
import { isRouteId, notFoundResponse } from "@/lib/http/route-id";
import type { Domain } from "@/lib/domain/types";
import { databaseNotReady } from "@/lib/http/database-gate";
import { illegalTransitionResponse } from "@/lib/http/illegal-transition-response";

const bodySchema = z.object({
  expectedRevision: z.number().int().nonnegative().safe(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ cycleId: string; domain: string }> },
): Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  const guard = await runMutationGuard(req, () => undefined, { bodyOptional: true });
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }
  const json = guard.json;

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "The reviewed revision is required." }, { status: 400 });
  }

  const { cycleId, domain } = await context.params;
  if (!isRouteId(cycleId) || !isRouteId(domain)) return notFoundResponse();
  const db = getDb();

  try {
    const result = await resumeReview(
      db,
      cycleId,
      domain as Domain,
      guard.actor,
      guard.workspaceId,
      parsed.data.expectedRevision,
    );
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) return illegalTransitionResponse(err);
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
