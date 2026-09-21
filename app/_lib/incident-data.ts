import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { getDb, type Db } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import {
  deploymentWorkspaceMap,
  isDeploymentVisible,
} from "@/lib/services/viewer-workspace";

export type IncidentLoadResult =
  | { status: "success"; incidents: IncidentListRow[] }
  | { status: "unavailable"; reason: "preview" | "load_failed"; incidents: null };

interface IncidentLoadOptions {
  db?: Db;
  providerMode?: string;
  hasDatabaseUrl?: boolean;
}

/** Load incidents for seeded + viewer-owned deployments without hiding read failures as empty. */
export async function loadIncidentsForViewer(
  viewerWorkspaceId: string | null,
  options: IncidentLoadOptions = {},
): Promise<IncidentLoadResult> {
  const providerMode = options.providerMode ?? process.env.DATA_PROVIDER;
  const hasDatabaseUrl = options.hasDatabaseUrl ?? !!process.env.DATABASE_URL;
  const mode = resolveDataProviderMode(providerMode, hasDatabaseUrl);
  if (mode !== "db") {
    return { status: "unavailable", reason: "preview", incidents: null };
  }

  try {
    const db = options.db ?? getDb();
    const [incidentRows, workspaceByDeployment] = await Promise.all([
      listIncidents(db),
      deploymentWorkspaceMap(db),
    ]);
    return {
      status: "success",
      incidents: incidentRows.filter((incident) =>
        isDeploymentVisible(workspaceByDeployment, incident.deploymentId, viewerWorkspaceId),
      ),
    };
  } catch {
    return { status: "unavailable", reason: "load_failed", incidents: null };
  }
}
