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
 *        `initiativeId` set (or omitted) -> project/deployment override for
 *        that initiative; `initiativeId: null` -> tier-default change (then
 *        `tier` is required).
 * 200:   SetEvalThresholdResult
 * 401/429/400: as other mutating routes.
 * 403:   { error: string }  (non-admin actor)
 * 404:   { error: string }  (unknown control/initiative/deployment/effective control)
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  setEvalThreshold,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/admin-service";
import { runMutationGuard } from "@/lib/services/route-guard";

const bodySchema = z.object({
  controlId: z.string().min(1).max(50),
  initiativeId: z.string().min(1).max(200).nullable().optional(),
  tier: z.enum(["low", "medium", "high", "critical"]).optional(),
  value: z.number(),
  reason: z.string().min(1).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const bodyText: Record<string, string> = {
    reason: typeof (json as { reason?: unknown })?.reason === "string" ? (json as { reason: string }).reason : "",
  };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "reason", maxChars: 2000 }],
    inputTotalCap: 2000,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const db = getDb();

  try {
    const result = await setEvalThreshold(db, guard.actor, {
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
