import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
/** Viewer-scoped server reads over the shared provider factory. */
import { cache } from "react";
import { cookies } from "next/headers";
import type { DataProvider } from "@/lib/data/provider";
import type { InitiativeDetail, InitiativeSummary } from "@/lib/data/dto";
import { getProvider } from "@/lib/data";
import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { requireViewer, WORKSPACE_COOKIE_NAME } from "@/lib/services/require-viewer";

/** Keep app callers on the same provider factory as API read callers. */
export function getAppProvider(): DataProvider {
  return getProvider({ snapshotHolder: requestSnapshotHolder });
}

/**
 * One snapshot holder per server render: React `cache` is request-scoped in a
 * render and a passthrough outside one, so route handlers and scripts get a
 * fresh holder per call and share nothing. Never replace with module state.
 */
const requestSnapshotHolder = cache(() => ({}));

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
  // requireViewer() is the viewer gate. The HTTP hop in the loader bypasses
  // getInitiativeDetailForViewer, so the gate runs here, first.
  return loadInitiativeDetailCoherent(slug, (await requireViewer()).workspaceId);
}

/**
 * Request-scoped (React cache) so generateMetadata and the page share one
 * snapshot load. The viewer workspace is an explicit argument, so it is part
 * of the cache key: two workspaces can never share an entry, and the cache
 * never outlives a request.
 */
const loadInitiativeDetailCoherent = cache(async (
  slug: string,
  viewerWorkspaceId: string | null,
): Promise<InitiativeDetail | null> => {
  const hasDatabaseUrl = !!runtimeDatabaseUrl();
  const pgliteDbMode = resolveDataProviderMode(process.env.DATA_PROVIDER, hasDatabaseUrl) === "db" && !hasDatabaseUrl;
  if (!pgliteDbMode) {
    return getAppProvider().getInitiativeDetail(slug, { viewerWorkspaceId });
  }

  // Fixed loopback origin: the Host and X-Forwarded-Proto of the incoming
  // request are caller-controlled and must never choose where this hop goes.
  const cookieStore = await cookies();
  const rawWorkspace = cookieStore.get(WORKSPACE_COOKIE_NAME)?.value ?? "";
  // Assumes the server answers plain HTTP on 127.0.0.1:PORT (true for next
  // start, next dev and the container). Under HTTPS or a non-loopback bind,
  // use a real database URL instead of PGlite.
  const res = await fetch(
    `http://127.0.0.1:${process.env.PORT || 3000}/initiatives/${encodeURIComponent(slug)}/detail-data`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      // Forward only the signed workspace cookie (read-scoping hint) so the
      // detail-data route scopes to the same viewer. The session cookie and
      // any other cookie are deliberately not forwarded.
      headers: { cookie: rawWorkspace ? `${WORKSPACE_COOKIE_NAME}=${rawWorkspace}` : "" },
    },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`detail-data fetch failed (${res.status})`);
  }
  return (await res.json()) as InitiativeDetail;
});
