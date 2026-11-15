// @vitest-environment node
/**
 * Production serves database rows or nothing. The fixture provider and the
 * local PGlite store are demo conveniences; a production process that would
 * land on either throws a configuration error instead of quietly serving
 * canned data to a real tenant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionConfigError } from "../config/deployment-mode";
import { DbDataProvider } from "./db-provider";
import { MockDataProvider } from "./mock-provider";
import { getProvider } from "./index";
import { getAppProvider } from "../../app/_lib/data-provider";

const connection = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db/client", () => ({ getDb: connection.getDb }));

beforeEach(() => {
  connection.getDb.mockReset();
  connection.getDb.mockReturnValue({});
});
afterEach(() => vi.unstubAllEnvs());

const DB_URL = "postgres://app:secret@db.internal:5432/jeeves";

function asProduction(env: { provider?: string; url?: string }): void {
  vi.stubEnv("JEEVES_MODE", undefined);
  vi.stubEnv("DATA_PROVIDER", env.provider);
  vi.stubEnv("DATABASE_URL", env.url ?? "");
  vi.stubEnv("POSTGRES_URL", "");
}

describe("the data provider factory in production", () => {
  it.each([
    ["DATA_PROVIDER=mock with a database URL", { provider: "mock", url: DB_URL }],
    ["DATA_PROVIDER=mock without a URL", { provider: "mock" }],
    ["no provider and no database URL", {}],
  ])("refuses the mock provider: %s", (_name, env) => {
    asProduction(env);
    expect(() => getProvider()).toThrow(ProductionConfigError);
    expect(() => getAppProvider()).toThrow(ProductionConfigError);
    expect(connection.getDb).not.toHaveBeenCalled();
  });

  it("names the variable to fix and carries no configured value", () => {
    asProduction({ provider: "mock", url: DB_URL });
    let message = "";
    try {
      getProvider();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATA_PROVIDER/);
    expect(message).not.toContain("secret");
    expect(message).not.toContain(DB_URL);
  });

  it("serves the database provider when a database is configured", () => {
    asProduction({ url: DB_URL });
    expect(getProvider()).toBeInstanceOf(DbDataProvider);
    expect(getAppProvider()).toBeInstanceOf(DbDataProvider);
  });

  it("treats a mistyped mode as production", () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    vi.stubEnv("DATA_PROVIDER", "mock");
    expect(() => getProvider()).toThrow(ProductionConfigError);
  });
});

describe("the data provider factory in demo", () => {
  it.each([
    ["mock", "", MockDataProvider],
    ["mock", DB_URL, MockDataProvider],
    [undefined, "", MockDataProvider],
    [undefined, DB_URL, DbDataProvider],
    ["db", "", DbDataProvider],
  ] as const)("selects exactly as before for DATA_PROVIDER=%s URL=%s", (provider, url, expected) => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("DATA_PROVIDER", provider);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("POSTGRES_URL", "");
    expect(getProvider()).toBeInstanceOf(expected);
  });
});
