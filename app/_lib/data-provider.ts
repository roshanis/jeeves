import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
/** Viewer-scoped server reads over the shared provider factory. */
import { headers } from "next/headers";
import type { DataProvider } from "@/lib/data/provider";
import type { InitiativeDetail, InitiativeSummary } from "@/lib/data/dto";
import { getProvider } from "@/lib/data";
import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { requireViewer } from "@/lib/services/require-viewer";

/** Keep app callers on the same provider factory as API read callers. */
export function getAppProvider(): DataProvider {
  return getProvider();
}

/**
 * The workspace id the current page request reads as, behind the viewer gate
 * (lib/services/require-viewer.ts).
 *
 * Demo: the signed `jeeves_workspace` cookie set by POST /api/session, or null
 * for a visitor with none (seeded-only view). It is a READ-SCOPING hint, never
 * an auth credential, and POST /api/session signs it
 * (lib/security/workspace-cookie.ts) so a caller cannot set an arbitrary value
 * to read another workspace's live-created rows; an invalid, unsigned or
 * tampered cookie degrades to null, never an error.
 *
 * Production: the workspace of the signed-in session, and a request with no
 * session is redirected to /sign-in here, before any data is read. Every page
 * that reads through this module is gated by it.
 */
export async function getCurrentWorkspaceId(): Promise<string | null> {
  return (await requireViewer()).workspaceId;
}

/** `listInitiatives` scoped to the current viewer's workspace (seeded + own). */
export async function listInitiativesForViewer(): Promise<InitiativeSummary[]> {
  return getAppProvider().listInitiatives({
    viewerWorkspaceId: await getCurrentWorkspaceId(),
  });
}

/** `getInitiativeDetail` scoped to the current viewer's workspace. */
export async function getInitiativeDetailForViewer(
  slug: string,
): Promise<InitiativeDetail | null> {
  return getAppProvider().getInitiativeDetail(slug, {
    viewerWorkspaceId: await getCurrentWorkspaceId(),
  });
}

/**
 * Preserve the local PGlite route-to-page coherence workaround until direct
 * reads are verified across both supported Next bundlers and production start.
 * getDb now caches on globalThis, which shares a handle within one process;
 * it does not by itself prove all runtime module graphs share that realm.
 */
export async function getInitiativeDetailCoherent(
  slug: string,
): Promise<InitiativeDetail | null> {
  // The HTTP hop below bypasses getInitiativeDetailForViewer, so gate first.
  await requireViewer();
  const hasDatabaseUrl = !!runtimeDatabaseUrl();
  const pgliteDbMode = resolveDataProviderMode(process.env.DATA_PROVIDER, hasDatabaseUrl) === "db" && !hasDatabaseUrl;
  if (!pgliteDbMode) {
    return getInitiativeDetailForViewer(slug);
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) {
    return getInitiativeDetailForViewer(slug);
  }
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const res = await fetch(
    `${proto}://${host}/initiatives/${encodeURIComponent(slug)}/detail-data`,
    {
      cache: "no-store",
      // Forward the workspace cookie so the detail-data route handler scopes
      // to the same viewer (fetch does not carry the incoming cookies by
      // default). Read-scoping only — no credential is forwarded.
      headers: { cookie: requestHeaders.get("cookie") ?? "" },
    },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`detail-data fetch failed (${res.status})`);
  }
  return (await res.json()) as InitiativeDetail;
}
