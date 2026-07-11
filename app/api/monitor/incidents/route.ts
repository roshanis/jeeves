/**
 * GET /api/monitor/incidents — public read-only incident list (task brief
 * deliverable 3). No session required, matching the established GET-routes-
 * stay-public-read-only pattern (see app/api/initiatives/[id]/draft-run/route.ts's
 * GET handler) — read-only endpoints never mutate state, so they are exempt
 * from `runMutationGuard`.
 *
 * 200: { incidents: IncidentListRow[] }
 */
import { getDb } from "@/lib/db/client";
import { listIncidents } from "@/lib/services/monitor-service";

export async function GET(): Promise<Response> {
  const db = getDb();
  const incidents = await listIncidents(db);
  return Response.json({ incidents }, { status: 200 });
}
