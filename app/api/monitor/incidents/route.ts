/**
 * GET /api/monitor/incidents — public read-only incident list (task brief
 * deliverable 3). No session required, matching the established GET-routes-
 * stay-public-read-only pattern (see app/api/initiatives/[id]/draft-run/route.ts's
 * GET handler) — read-only endpoints never mutate state, so they are exempt
 * from `runMutationGuard`.
 *
 * Read isolation (P0 pass, external-review finding 2): incidents carry no
 * workspace column of their own — ownership resolves via
 * deploymentId -> initiative.workspaceId, same as every other derived
 * entity in this schema. The response is scoped to the viewer resolved from
 * the request (session, else signed `jeeves_workspace` cookie, else
 * anonymous/seeded-only) exactly like every other public read surface —
 * never "all workspaces" for an HTTP caller.
 *
 * `req` is optional only so this handler stays callable the way the
 * existing HTTP-layer test suite already calls it (`GET()`, no request) —
 * that degrades to the anonymous/seeded-only view, the safe default.
 *
 * 200: { incidents: IncidentListRow[] }
 */
import { getDb } from "@/lib/db/client";
import { listIncidents } from "@/lib/services/monitor-service";
import {
  deploymentWorkspaceMap,
  isDeploymentVisible,
  resolveViewerWorkspaceId,
} from "@/lib/services/viewer-workspace";

export async function GET(req?: Request): Promise<Response> {
  const db = getDb();
  const viewerWorkspaceId = req ? await resolveViewerWorkspaceId(req) : null;
  const [incidents, workspaceByDeployment] = await Promise.all([
    listIncidents(db),
    deploymentWorkspaceMap(db),
  ]);
  const visible = incidents.filter((inc) =>
    isDeploymentVisible(workspaceByDeployment, inc.deploymentId, viewerWorkspaceId),
  );
  return Response.json({ incidents: visible }, { status: 200 });
}
