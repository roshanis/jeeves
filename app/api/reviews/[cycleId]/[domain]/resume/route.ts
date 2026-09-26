import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
  resumeReview,
} from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";
import type { Domain } from "@/lib/domain/types";

const bodySchema = z.object({
  expectedRevision: z.number().int().nonnegative().safe(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ cycleId: string; domain: string }> },
): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const guard = await runMutationGuard(req, {});
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "The reviewed revision is required." }, { status: 400 });
  }

  const { cycleId, domain } = await context.params;
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
