import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
/** Viewer-scoped server reads over the shared provider factory. */
import { cookies, headers } from "next/headers";
import type { DataProvider } from "@/lib/data/provider";
import type { InitiativeDetail, InitiativeSummary } from "@/lib/data/dto";
import { getProvider } from "@/lib/data";
import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { resolveWorkspaceCookieSecret, verifyWorkspaceCookie } from "@/lib/security/workspace-cookie";

const WORKSPACE_COOKIE = "jeeves_workspace";

/** Keep app callers on the same provider factory as API read callers. */
export function getAppProvider(): DataProvider {
  return getProvider();
}

/**
 * The current browser's demo workspace id, or null for a public/no-session
 * visitor (M2.5 inc.2b). This reads the `jeeves_workspace` cookie set by
 * POST /api/session — it is a READ-SCOPING hint, never an auth credential.
 * null => seeded-only; a value => seeded + that workspace's live-created rows.
 *
 * Security-hardening pass: POST /api/session now signs this cookie
 * (lib/security/workspace-cookie.ts) so a caller cannot simply set an
 * arbitrary `jeeves_workspace` value to read another workspace's
 * live-created rows. Verified here the same way; an invalid/unsigned/
 * tampered cookie degrades to null (seeded-only view), never an error.
 */
export async function getCurrentWorkspaceId(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(WORKSPACE_COOKIE)?.value ?? null;
  return verifyWorkspaceCookie(raw, resolveWorkspaceCookieSecret());
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
