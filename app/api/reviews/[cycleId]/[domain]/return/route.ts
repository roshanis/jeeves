/**
 * POST /api/reviews/[cycleId]/[domain]/return — reviewer returns a domain
 * review with a required reason (task brief deliverable 3). Reviewer-role
 * only, AND the reviewer must be assigned to this exact domain (each of the
 * 4 named reviewer personas owns exactly one domain); `returnReview` itself
 * enforces both and throws `IllegalTransitionError` otherwise (mapped to
 * 403 here).
 *
 * Body:  { reason: string }
 * 200:   { cycleId, domain, status: "returned" }
 * 401/429: as other mutating routes.
 * 400:   { error: string }  (missing/empty reason, invalid body, input-size gap)
 * 403:   { error: string }  (non-reviewer actor, or reviewer not assigned to this domain)
 * 404:   { error: string }  (unknown cycle/domain pair)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { IllegalTransitionError, NotFoundError, ValidationError, returnReview } from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";
import type { Domain } from "@/lib/domain/types";

const bodySchema = z.object({
  reason: z.string().min(1).max(2000),
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
  const reasonText: Record<string, string> =
    typeof (json as { reason?: unknown })?.reason === "string" ? { reason: (json as { reason: string }).reason } : {};

  const guard = await runMutationGuard(req, reasonText, {
    inputLimits: [{ field: "reason", maxChars: 2000 }],
    inputTotalCap: 2000,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "reason is required" }, { status: 400 });
  }

  const { cycleId, domain } = await context.params;
  const db = getDb();

  try {
    const result = await returnReview(db, cycleId, domain as Domain, guard.actor, parsed.data.reason);
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
