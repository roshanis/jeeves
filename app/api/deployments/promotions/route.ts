/**
 * GET /api/deployments/promotions — public, read-only list of RL checkpoints
 * awaiting feedback-provenance sign-off (plan.md M3; docs/seed-spec.md #5
 * pa-correspondence-model's promotion-gate story). No session/guard, matching
 * the existing public-GET precedent (e.g.
 * app/api/initiatives/[id]/draft-run/route.ts's progress-polling GET).
 *
 * 200: PromotionListItem[]
 */
import { getDb } from "@/lib/db/client";
import { listPromotions } from "@/lib/services/promotion-service";

export async function GET(): Promise<Response> {
  const db = getDb();
  const list = await listPromotions(db);
  return Response.json(list, { status: 200 });
}
