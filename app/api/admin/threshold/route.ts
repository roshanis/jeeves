/**
 * POST /api/admin/threshold — the first live admin action (plan.md §2 step
 * 8, §9 P3; task brief deliverable 3): change an eval-quality control's
 * threshold. Admin-only + non-empty reason, enforced inside
 * `setEvalThreshold` (`ForbiddenError`/`ValidationError` mapped to 403/400
 * here) — mirrors the guard-order used by every other mutating route
 * (session -> rate-limit -> input-validation, via `runMutationGuard`, THEN
 * the role check, matching app/api/initiatives/route.ts's requester-only
 * check happening after the shared guard).
 *
 * Body:  { controlId: string, initiativeId?: string | null, tier?: Tier, value: number, reason: string }
 *        `initiativeId` set -> project/deployment override for that
 *        initiative; `initiativeId: null` or omitted -> tier-default change
 *        (then `tier` is required; 403 for any session with a workspace).
 *        `value` is a rate in 0..1; the control must be a runtime-evaluated
 *        one (tier defaults + sustained window), else 400.
 * 200:   SetEvalThresholdResult
 * 401/429/400: as other mutating routes.
 * 403:   { error: string }  (non-admin actor)
 * 404:   { error: string }  (unknown control/initiative/deployment/effective
 *        control; also a project-override targeting a workspace-tagged
 *        initiative belonging to a DIFFERENT workspace than this session's —
 *        same shape, no existence leak; P1 fix)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  setEvalThreshold,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/admin-service";
import { guardFailureResponse, runMutationGuard } from "@/lib/services/route-guard";
import { databaseNotReady } from "@/lib/http/database-gate";

const bodySchema = z.object({
  controlId: z.string().min(1).max(50),
  initiativeId: z.string().min(1).max(200).nullable().optional(),
  tier: z.enum(["low", "medium", "high", "critical"]).optional(),
  value: z.number().min(0).max(1),
  reason: z.string().min(1).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  const guard = await runMutationGuard(req, (json) => {
    const bodyText: Record<string, string> = {
      reason: typeof (json as { reason?: unknown })?.reason === "string" ? (json as { reason: string }).reason : "",
    };
    return bodyText;
  }, {
    inputLimits: [{ field: "reason", maxChars: 2000 }],
    inputTotalCap: 2000,
  });
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }
  const json = guard.json;

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const db = getDb();

  try {
    const result = await setEvalThreshold(db, guard.actor, guard.workspaceId, {
      controlId: parsed.data.controlId,
      initiativeId: parsed.data.initiativeId ?? null,
      tier: parsed.data.tier,
      newValue: parsed.data.value,
      reason: parsed.data.reason,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
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
