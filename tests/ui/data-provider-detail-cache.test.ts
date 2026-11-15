import { beforeEach, describe, expect, it, vi } from "vitest";

const getInitiativeDetail = vi.fn(async (slug: string, opts?: { viewerWorkspaceId?: string | null }) => ({
  slug,
  workspace: opts?.viewerWorkspaceId ?? null,
}));
let workspace: string | null = null;

vi.mock("@/lib/data", () => ({ getProvider: () => ({ getInitiativeDetail }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "signed" }) }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/security/workspace-cookie", () => ({
  resolveWorkspaceCookieSecret: () => "s",
  verifyWorkspaceCookie: () => workspace,
}));
vi.mock("@/lib/db/runtime-config", () => ({ runtimeDatabaseUrl: () => "postgres://x" }));

import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";

describe("getInitiativeDetailCoherent", () => {
  beforeEach(() => getInitiativeDetail.mockClear());

  it("scopes every read to the current viewer workspace and never shares one workspace's result with another", async () => {
    workspace = "ws-a";
    const a = await getInitiativeDetailCoherent("x");
    workspace = "ws-b";
    const b = await getInitiativeDetailCoherent("x");
    expect(a).toEqual({ slug: "x", workspace: "ws-a" });
    expect(b).toEqual({ slug: "x", workspace: "ws-b" });
    expect(getInitiativeDetail).toHaveBeenNthCalledWith(1, "x", { viewerWorkspaceId: "ws-a" });
    expect(getInitiativeDetail).toHaveBeenNthCalledWith(2, "x", { viewerWorkspaceId: "ws-b" });
  });
});
