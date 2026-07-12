/**
 * POST /api/reviews/[cycleId]/[domain]/sign — reviewer signs off a domain
 * review (task brief deliverable 3). Reviewer-role only, AND the reviewer
 * must be assigned to this exact domain (each of the 4 named reviewer
 * personas owns exactly one domain); `signReview` itself enforces both and
 * throws `IllegalTransitionError` otherwise (mapped to 403 here).
 *
 * Body:  { editedDraftMd?: string }
 * 200:   { cycleId, domain, status: "signed" }
 * 401/429/400: as other mutating routes.
 * 403:   { error: string }  (non-reviewer actor, or reviewer not assigned to this domain)
 * 404:   { error: string }  (unknown cycle/domain pair)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { IllegalTransitionError, NotFoundError, ValidationError, signReview } from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";
import type { Domain } from "@/lib/domain/types";

const bodySchema = z.object({
  editedDraftMd: z.string().max(20_000).optional(),
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
  const bodyText: Record<string, string> =
    typeof (json as { editedDraftMd?: unknown })?.editedDraftMd === "string"
      ? { editedDraftMd: (json as { editedDraftMd: string }).editedDraftMd }
      : {};

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "editedDraftMd", maxChars: 20_000 }],
    inputTotalCap: 20_000,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { cycleId, domain } = await context.params;
  const db = getDb();

  try {
    const result = await signReview(db, cycleId, domain as Domain, guard.actor, parsed.data.editedDraftMd);
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
