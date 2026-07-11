/**
 * App-side DataProvider selector — a workaround, not a replacement.
 *
 * `lib/data/index.ts#getProvider()` loads DbDataProvider via a lazy CJS
 * `require("./db-provider")`. Under Next 16's Turbopack dev server that
 * require returns a module object whose named export is not usable
 * ("TypeError: DbDataProvider is not a constructor"), so every page render
 * crashes when DATA_PROVIDER=db / DATABASE_URL selects the DB provider.
 * That file is owned by the data-layer team (read-only for the UI task), so
 * the UI routes select their provider here instead, using a static ESM
 * import (bundler-safe) with EXACTLY the same selection semantics:
 *
 *   - DATA_PROVIDER=db          -> DbDataProvider (Neon when DATABASE_URL is
 *                                  set, else the persistent PGlite store)
 *   - DATA_PROVIDER=mock        -> MockDataProvider (via getProvider())
 *   - unset                     -> DbDataProvider iff DATABASE_URL is set,
 *                                  else MockDataProvider
 *
 * Mock-mode behavior is delegated to the original `getProvider()` so the
 * two selectors can never disagree about the mock singleton. Once the
 * upstream require-interop bug is fixed, this module can be deleted and the
 * pages can import getProvider directly again.
 */
import { headers } from "next/headers";
import type { DataProvider } from "@/lib/data/provider";
import type { InitiativeDetail } from "@/lib/data/dto";
import { getProvider } from "@/lib/data";
import { DbDataProvider } from "@/lib/data/db-provider";

let dbSingleton: DataProvider | null = null;

export function getAppProvider(): DataProvider {
  const mode = process.env.DATA_PROVIDER;
  const useDb = mode === "db" || (mode !== "mock" && !!process.env.DATABASE_URL);
  if (useDb) {
    if (!dbSingleton) {
      dbSingleton = new DbDataProvider();
    }
    return dbSingleton;
  }
  return getProvider();
}

/**
 * Coherent InitiativeDetail load for the detail PAGE.
 *
 * Next bundles produce multiple server module graphs in one process (page
 * HTML vs RSC-nav vs route handlers), and `lib/db/client.ts#getDb()`
 * memoizes a PGlite handle per module instance with lazy point-in-time
 * load semantics. Consequence (verified empirically): when running on the
 * local PGlite store, a page-graph render CANNOT see rows the /api/**
 * route-handler graph just wrote — a live-created initiative 404s on its
 * own detail page even though the API created it seconds earlier. Route
 * handlers all share one graph (the in-memory session map already proves
 * it), so in PGlite mode this helper hops over HTTP to the UI-owned
 * `GET /initiatives/[slug]/detail-data` route handler instead of querying
 * from the page graph.
 *
 * With a real DATABASE_URL (Neon's stateless HTTP driver: every query hits
 * the shared remote DB) — or in mock mode (static in-memory dataset) —
 * there is no coherence problem and the provider is called directly.
 */
export async function getInitiativeDetailCoherent(
  slug: string,
): Promise<InitiativeDetail | null> {
  const mode = process.env.DATA_PROVIDER;
  const pgliteDbMode = mode === "db" && !process.env.DATABASE_URL;
  if (!pgliteDbMode) {
    return getAppProvider().getInitiativeDetail(slug);
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) {
    return getAppProvider().getInitiativeDetail(slug);
  }
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const res = await fetch(
    `${proto}://${host}/initiatives/${encodeURIComponent(slug)}/detail-data`,
    { cache: "no-store" },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`detail-data fetch failed (${res.status})`);
  }
  return (await res.json()) as InitiativeDetail;
}
