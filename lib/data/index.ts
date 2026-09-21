import type { DataProvider } from "./provider";
import { MockDataProvider } from "./mock-provider";
import { DbDataProvider } from "./db-provider";
import { resolveDataProviderMode } from "./provider-mode";

/**
 * Server-side factory shared by pages and API reads. Static ESM imports avoid
 * lazy CommonJS interop; constructors open a database only when DB is selected.
 * DATA_PROVIDER=db selects the DB even without a URL (local PGlite); mock
 * explicitly selects fixtures. Otherwise a configured URL selects the DB.
 * Facades are short-lived; getDb owns the shared underlying connection.
 */
export function getProvider(): DataProvider {
  const mode = resolveDataProviderMode(process.env.DATA_PROVIDER, !!process.env.DATABASE_URL);
  return mode === "db" ? new DbDataProvider() : new MockDataProvider();
}
