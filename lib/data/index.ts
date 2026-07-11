import type { DataProvider } from "./provider";
import { MockDataProvider } from "./mock-provider";

let singleton: DataProvider | null = null;

/**
 * Returns the active DataProvider singleton.
 *
 * Selection (single swap point for the whole app):
 *   - DATA_PROVIDER=db     → DbDataProvider (Neon when DATABASE_URL is set,
 *                            else the persistent PGlite store at .pglite/ —
 *                            run `npm run db:seed` first)
 *   - DATA_PROVIDER=mock   → MockDataProvider
 *   - unset                → DbDataProvider when DATABASE_URL is set,
 *                            else MockDataProvider (keeps jsdom/unit tests
 *                            and credential-less checkouts working)
 *
 * DbDataProvider is imported lazily so mock-only environments (jsdom tests)
 * never load the Postgres/PGlite driver chain.
 */
export function getProvider(): DataProvider {
  if (!singleton) {
    const mode = process.env.DATA_PROVIDER;
    const useDb = mode === "db" || (mode !== "mock" && !!process.env.DATABASE_URL);
    if (useDb) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DbDataProvider } = require("./db-provider") as typeof import("./db-provider");
      singleton = new DbDataProvider();
    } else {
      singleton = new MockDataProvider();
    }
  }
  return singleton;
}
