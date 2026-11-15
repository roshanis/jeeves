import { ProductionConfigError, isProductionMode } from "../config/deployment-mode";
import { runtimeDatabaseUrl } from "../db/runtime-config";
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
 *
 * Production never serves the mock fixtures: DATA_PROVIDER=mock, or no
 * database at all, throws a configuration error here instead of showing a real
 * tenant canned data. (The database half of "no fallback" is getDb(), which
 * refuses PGlite in production.)
 */
export function getProvider(): DataProvider {
  const mode = resolveDataProviderMode(process.env.DATA_PROVIDER, !!runtimeDatabaseUrl());
  if (mode === "mock" && isProductionMode()) {
    throw new ProductionConfigError([
      "the mock data provider is not available in production: configure DATABASE_URL (or POSTGRES_URL) and do not set DATA_PROVIDER=mock",
    ]);
  }
  return mode === "db" ? new DbDataProvider() : new MockDataProvider();
}
