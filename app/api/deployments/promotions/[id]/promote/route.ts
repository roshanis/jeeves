/**
 * POST /api/deployments/promotions/[id]/promote — approver-only RL-checkpoint
 * promotion (plan.md M3; docs/seed-spec.md #5 pa-correspondence-model's
 * promotion-gate story). `[id]` is the `deployment_versions` id (the
 * checkpoint), not the initiative id — unlike
 * app/api/admin/deployments/[id]/pause|resume/route.ts, which resolve the
 * initiative's current deployment internally, `promoteCheckpoint` operates
 * directly on a specific checkpoint row (`listPromotions` returns
 * `deploymentVersionId` for exactly this purpose).
 *
 * Role-gating (approver-only) happens in the SERVICE layer
 * (`promoteCheckpoint` throws `ForbiddenError` for non-approver actors),
 * mirroring app/api/admin/threshold/route.ts's pattern: `runMutationGuard`
 * only session/rate-limit/input-gates here; the role check runs after,
 * inside the service call, and its error is mapped to 403 below.
 *
 * `requiresBudget` is NOT set — this action never invokes an LLM/agent, it
 * only flips DB rows and writes audit events (unlike
 * app/api/initiatives/[id]/draft-run/route.ts's POST, which reserves budget
 * for its AgentPort fan-out).
 *
 * Body:  { attestation: { feedbackDataSource: string, consentBasis: string,
 *          reviewedBy: string }, reason: string }
 * 200:   PromoteCheckpointResult
 * 401/429: as other mutating routes.
 * 400:   { error: string }  (malformed body; missing/empty attestation field
 *        or reason; OR the checkpoint is not currently awaiting sign-off,
 *        e.g. a double-promote attempt — see promotion-service.ts's
 *        "JUDGMENT CALL 3": no existing route in this codebase uses 409
 *        anywhere, so this reuses the same `ValidationError` -> 400 mapping
 *        every other service-error-to-HTTP mapping here already uses,
 *        rather than introducing a novel status code for a single case.)
 * 403:   { error: string }  (non-approver actor — admin/reviewer/etc.)
 * 404:   { error: string }  (unknown deployment version id)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  promoteCheckpoint,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/promotion-service";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  attestation: z.object({
    feedbackDataSource: z.string().max(2000),
    consentBasis: z.string().max(2000),
    reviewedBy: z.string().max(200),
  }),
  reason: z.string().max(2000),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const body = json as {
    attestation?: { feedbackDataSource?: unknown; consentBasis?: unknown; reviewedBy?: unknown };
    reason?: unknown;
  };

  const bodyText: Record<string, string> = {
    feedbackDataSource:
      typeof body?.attestation?.feedbackDataSource === "string" ? body.attestation.feedbackDataSource : "",
    consentBasis: typeof body?.attestation?.consentBasis === "string" ? body.attestation.consentBasis : "",
    reviewedBy: typeof body?.attestation?.reviewedBy === "string" ? body.attestation.reviewedBy : "",
    reason: typeof body?.reason === "string" ? body.reason : "",
  };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [
      { field: "feedbackDataSource", maxChars: 2000 },
      { field: "consentBasis", maxChars: 2000 },
      { field: "reviewedBy", maxChars: 200 },
      { field: "reason", maxChars: 2000 },
    ],
    inputTotalCap: 6600,
    requiresBudget: false,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { id } = await context.params;
  const db = getDb();

  try {
    const result = await promoteCheckpoint(
      db,
      id,
      guard.actor,
      parsed.data.attestation,
      parsed.data.reason,
    );
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message, issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
