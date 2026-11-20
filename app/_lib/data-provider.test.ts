import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireViewer = vi.fn();
const getProvider = vi.fn();
const cookieGet = vi.fn();

vi.mock("@/lib/services/require-viewer", () => ({
  requireViewer: (...args: unknown[]) => requireViewer(...args),
  WORKSPACE_COOKIE_NAME: "jeeves_workspace",
}));
vi.mock("@/lib/data", () => ({ getProvider: (...args: unknown[]) => getProvider(...args) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));

import {
  getCurrentWorkspaceId,
  getInitiativeDetailCoherent,
  getInitiativeDetailForViewer,
  listInitiativesForViewer,
} from "./data-provider";

const provider = { listInitiatives: vi.fn(), getInitiativeDetail: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  getProvider.mockReturnValue(provider);
  requireViewer.mockResolvedValue({ workspaceId: "ws-viewer" });
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "");
  vi.stubEnv("DATA_PROVIDER", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("viewer-scoped reads", () => {
  it("takes the workspace from the viewer gate, never from the caller", async () => {
    await expect(getCurrentWorkspaceId()).resolves.toBe("ws-viewer");
  });

  it("lists initiatives scoped to the viewer's workspace", async () => {
    provider.listInitiatives.mockResolvedValue([]);
    await listInitiativesForViewer();
    expect(provider.listInitiatives).toHaveBeenCalledWith({ viewerWorkspaceId: "ws-viewer" });
  });

  it("reads one initiative scoped to the viewer's workspace", async () => {
    provider.getInitiativeDetail.mockResolvedValue(null);
    await getInitiativeDetailForViewer("some-slug");
    expect(provider.getInitiativeDetail).toHaveBeenCalledWith("some-slug", { viewerWorkspaceId: "ws-viewer" });
  });

  it("a viewer with no workspace reads as null (seeded view), not as someone else", async () => {
    requireViewer.mockResolvedValue({ workspaceId: null });
    provider.listInitiatives.mockResolvedValue([]);
    await listInitiativesForViewer();
    expect(provider.listInitiatives).toHaveBeenCalledWith({ viewerWorkspaceId: null });
  });

  it("does not read anything when the viewer gate rejects", async () => {
    requireViewer.mockRejectedValue(new Error("redirect"));
    await expect(listInitiativesForViewer()).rejects.toThrow("redirect");
    expect(provider.listInitiatives).not.toHaveBeenCalled();
  });
});

describe("getInitiativeDetailCoherent over local PGlite", () => {
  const pgliteMode = () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    vi.stubEnv("PORT", "3117");
  };

  it("reads through the provider directly when a database URL is configured", async () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    provider.getInitiativeDetail.mockResolvedValue({ slug: "s" });
    await expect(getInitiativeDetailCoherent("s")).resolves.toEqual({ slug: "s" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the loopback route and forwards only the workspace cookie", async () => {
    pgliteMode();
    cookieGet.mockReturnValue({ value: "signed-value" });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ slug: "a b" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getInitiativeDetailCoherent("a b")).resolves.toEqual({ slug: "a b" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3117/initiatives/a%20b/detail-data");
    expect(init.headers).toEqual({ cookie: "jeeves_workspace=signed-value" });
  });

  it("sends no cookie when the visitor has none", async () => {
    pgliteMode();
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await getInitiativeDetailCoherent("unique-slug-no-cookie");
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ cookie: "" });
  });

  it("maps a 404 to null", async () => {
    pgliteMode();
    cookieGet.mockReturnValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
    await expect(getInitiativeDetailCoherent("unique-slug-404")).resolves.toBeNull();
  });

  it("throws on any other failure status", async () => {
    pgliteMode();
    cookieGet.mockReturnValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false }));
    await expect(getInitiativeDetailCoherent("unique-slug-500")).rejects.toThrow("detail-data fetch failed (500)");
  });
});
