// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
afterEach(() => { vi.unstubAllEnvs(); });

describe("shared ESM provider factory", () => {
  it.each([
    ["mock", "", "mock"],
    ["mock", "postgres://fixture.invalid/unused", "mock"],
    ["db", "", "db"],
    [undefined, "postgres://fixture.invalid/unused", "db"],
  ] as const)("selects the same page and API provider type for %s mode and URL %s", (mode, url, expected) => {
    vi.stubEnv("DATA_PROVIDER", mode);
    vi.stubEnv("DATABASE_URL", url);
    const providerType = expected === "db" ? DbDataProvider : MockDataProvider;
    expect(getAppProvider()).toBeInstanceOf(providerType);
    expect(getProvider()).toBeInstanceOf(providerType);
    expect(connection.getDb).toHaveBeenCalledTimes(expected === "db" ? 2 : 0);
  });

  it("reflects provider-mode changes without resetting loaded modules", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATA_PROVIDER", "mock");
    expect(getProvider()).toBeInstanceOf(MockDataProvider);
    vi.stubEnv("DATA_PROVIDER", "db");
    expect(getAppProvider()).toBeInstanceOf(DbDataProvider);
    vi.stubEnv("DATA_PROVIDER", "mock");
    expect(getProvider()).toBeInstanceOf(MockDataProvider);
    expect(connection.getDb).toHaveBeenCalledTimes(1);
  });

  it("obtains the current DB handle for each facade while leaving connection caching to getDb", () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    const first = getProvider();
    const second = getAppProvider();
    expect(first).toBeInstanceOf(DbDataProvider);
    expect(second).toBeInstanceOf(DbDataProvider);
    expect(second).not.toBe(first);
    expect(connection.getDb).toHaveBeenCalledTimes(2);
  });
});
