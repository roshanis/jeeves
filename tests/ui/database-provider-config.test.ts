import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detail: vi.fn().mockResolvedValue(null), fallback: { kind: "mock" } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ host: "localhost:3117" }),
}));
vi.mock("@/lib/data", () => ({ getProvider: () => mocks.fallback }));
vi.mock("@/lib/data/db-provider", () => ({
  DbDataProvider: class { kind = "db"; getInitiativeDetail = mocks.detail; },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "postgres://fixture:fixture@db.example.test/fixture");
  vi.stubEnv("DATA_PROVIDER", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("hosted integration data selection", () => {
  it("uses database page data when the integration supplies only POSTGRES_URL", async () => {
    const { getAppProvider } = await import("@/app/_lib/data-provider");
    expect(getAppProvider()).toHaveProperty("kind", "db");
  });

  it("preserves an explicit mock-provider override", async () => {
    vi.stubEnv("DATA_PROVIDER", "mock");
    const { getAppProvider } = await import("@/app/_lib/data-provider");
    expect(getAppProvider()).toBe(mocks.fallback);
  });

  it("does not route network database detail reads through the local PGlite HTTP workaround", async () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Unexpected HTTP workaround"));
    vi.stubGlobal("fetch", fetchSpy);
    const { getInitiativeDetailCoherent } = await import("@/app/_lib/data-provider");
    await expect(getInitiativeDetailCoherent("example")).resolves.toBeNull();
    expect(mocks.detail).toHaveBeenCalledWith("example", { viewerWorkspaceId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
