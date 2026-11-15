import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { getDb, type Db } from "@/lib/db/client";
import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
import { listIncidentsForViewer, type IncidentListRow } from "@/lib/services/monitor-service";

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
  const hasDatabaseUrl = options.hasDatabaseUrl ?? !!runtimeDatabaseUrl();
  const mode = resolveDataProviderMode(providerMode, hasDatabaseUrl);
  if (mode !== "db") {
    return { status: "unavailable", reason: "preview", incidents: null };
  }

  try {
    const db = options.db ?? getDb();
    return { status: "success", incidents: await listIncidentsForViewer(db, viewerWorkspaceId) };
  } catch (error) {
    // Code only (from an allowlist-free read of `code`/`name`): the message can carry the connection string.
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : error instanceof Error ? error.name : "UNKNOWN";
    console.error("Incident load failed", { causeCode: code });
    return { status: "unavailable", reason: "load_failed", incidents: null };
  }
}
