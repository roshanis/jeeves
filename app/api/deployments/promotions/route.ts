/**
 * GET /api/deployments/promotions — read-only list of RL checkpoints
 * awaiting feedback-provenance sign-off (plan.md M3; docs/seed-spec.md #5
 * pa-correspondence-model's promotion-gate story). Behind the read gate
 * (lib/services/require-viewer.ts): open to anonymous visitors in demo, 401
 * without a session in production.
 *
 * Read isolation (P0 pass, external-review finding 2): each entry already
 * carries its owning `initiativeId`; the response is scoped to the viewer
 * resolved from the request (session, else signed `jeeves_workspace`
 * cookie, else anonymous/seeded-only) exactly like every other read
 * surface — never "all workspaces" for an HTTP caller.
 *
 * 200: PromotionListItem[]
 * 401: production, no session
 * 503: this server failed its boot checks
 */
import { getDb } from "@/lib/db/client";
import { listPromotions } from "@/lib/services/promotion-service";
import {
  initiativeWorkspaceMap,
  isInitiativeVisible,
} from "@/lib/services/viewer-workspace";
import { requireViewerForRequest } from "@/lib/services/require-viewer";

export async function GET(req: Request): Promise<Response> {
  const gate = await requireViewerForRequest(req);
  if (!gate.ok) return gate.response;
  const db = getDb();
  const viewerWorkspaceId = gate.viewer.workspaceId;
  const [list, workspaceByInitiative] = await Promise.all([
    listPromotions(db),
    initiativeWorkspaceMap(db),
  ]);
  const visible = list.filter((p) =>
    isInitiativeVisible(workspaceByInitiative, p.initiativeId, viewerWorkspaceId),
  );
  return Response.json(visible, { status: 200 });
}
