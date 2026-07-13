/**
 * POST /api/exceptions/[id]/revoke — revoke an approved exception early.
 * Approver/admin only (`revokeException` -> IllegalTransitionError -> 403).
 *   Body: { reason: string }
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { runMutationGuard } from "@/lib/services/route-guard";
import { revokeException } from "@/lib/services/exception-service";
import { NotFoundError, ValidationError, IllegalTransitionError } from "@/lib/services/initiative-service";

const REASON_MAX = 2_000;
const bodySchema = z.object({ reason: z.string().min(1).max(REASON_MAX) });

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const bodyText: Record<string, string> =
    typeof (json as { reason?: unknown })?.reason === "string"
      ? { reason: (json as { reason: string }).reason }
      : {};

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "reason", maxChars: REASON_MAX }],
    inputTotalCap: REASON_MAX,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const result = await revokeException(getDb(), id, guard.actor, parsed.data.reason);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) return Response.json({ error: err.message }, { status: 403 });
    if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
