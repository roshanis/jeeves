/**
 * GET /api/deployments/promotions — public, read-only list of RL checkpoints
 * awaiting feedback-provenance sign-off (plan.md M3; docs/seed-spec.md #5
 * pa-correspondence-model's promotion-gate story). No session/guard, matching
 * the existing public-GET precedent (e.g.
 * app/api/initiatives/[id]/draft-run/route.ts's progress-polling GET).
 *
 * Read isolation (P0 pass, external-review finding 2): each entry already
 * carries its owning `initiativeId`; the response is scoped to the viewer
 * resolved from the request (session, else signed `jeeves_workspace`
 * cookie, else anonymous/seeded-only) exactly like every other public read
 * surface — never "all workspaces" for an HTTP caller.
 *
 * `req` is optional only so this handler stays callable the way the
 * existing HTTP-layer test suite already calls it (`GET()`, no request) —
 * that degrades to the anonymous/seeded-only view, the safe default.
 *
 * 200: PromotionListItem[]
 */
import { getDb } from "@/lib/db/client";
import { listPromotions } from "@/lib/services/promotion-service";
import {
  initiativeWorkspaceMap,
  isInitiativeVisible,
  resolveViewerWorkspaceId,
} from "@/lib/services/viewer-workspace";

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  const viewerWorkspaceId = await resolveViewerWorkspaceId(req);
  const [list, workspaceByInitiative] = await Promise.all([
    listPromotions(db),
    initiativeWorkspaceMap(db),
  ]);
  const visible = list.filter((p) =>
    isInitiativeVisible(workspaceByInitiative, p.initiativeId, viewerWorkspaceId),
  );
  return Response.json(visible, { status: 200 });
}
