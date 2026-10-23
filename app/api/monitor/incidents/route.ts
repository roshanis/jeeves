/**
 * GET /api/monitor/incidents — read-only incident list (task brief
 * deliverable 3). Read-only endpoints never mutate state, so they are exempt
 * from `runMutationGuard`; they go through the read gate instead
 * (lib/services/require-viewer.ts): open to anonymous visitors in demo, 401
 * without a session in production.
 *
 * Read isolation (P0 pass, external-review finding 2): incidents carry no
 * workspace column of their own — ownership resolves via
 * deploymentId -> initiative.workspaceId, same as every other derived
 * entity in this schema. The response is scoped to the viewer resolved from
 * the request (session, else signed `jeeves_workspace` cookie, else
 * anonymous/seeded-only) exactly like every other read surface —
 * never "all workspaces" for an HTTP caller.
 *
 * 200: { incidents: IncidentListRow[] }
 * 401: production, no session
 * 503: this server failed its boot checks
 */
import { getDb } from "@/lib/db/client";
import { listIncidents } from "@/lib/services/monitor-service";
import {
  deploymentWorkspaceMap,
  isDeploymentVisible,
} from "@/lib/services/viewer-workspace";
import { requireViewerForRequest } from "@/lib/services/require-viewer";

export async function GET(req: Request): Promise<Response> {
  const gate = await requireViewerForRequest(req);
  if (!gate.ok) return gate.response;
  const db = getDb();
  const viewerWorkspaceId = gate.viewer.workspaceId;
  const [incidents, workspaceByDeployment] = await Promise.all([
    listIncidents(db),
    deploymentWorkspaceMap(db),
  ]);
  const visible = incidents.filter((inc) =>
    isDeploymentVisible(workspaceByDeployment, inc.deploymentId, viewerWorkspaceId),
  );
  return Response.json({ incidents: visible }, { status: 200 });
}
