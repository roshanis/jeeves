import type { DataProvider } from "./provider";
import { MockDataProvider } from "./mock-provider";

let singleton: DataProvider | null = null;

/**
 * Returns the active DataProvider singleton.
 *
 * SWAP POINT: once lib/data/db-provider.ts exists and DATABASE_URL is
 * configured, branch here — e.g.
 *   return process.env.DATABASE_URL ? getDbProvider() : getMockProvider();
 * Today only the mock provider exists, so this always returns it.
 */
export function getProvider(): DataProvider {
  if (!singleton) {
    singleton = new MockDataProvider();
  }
  return singleton;
}
