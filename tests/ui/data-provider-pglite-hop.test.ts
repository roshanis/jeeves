import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getProvider: () => ({ getInitiativeDetail: vi.fn() }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "jeeves_workspace" ? { value: "ws_abc12345.mac" } : undefined) }),
  headers: async () => new Headers({
    host: "evil.example",
    "x-forwarded-proto": "https",
    cookie: "jeeves_session=secret-token; jeeves_workspace=ws_abc12345.mac; other=1",
  }),
}));
vi.mock("@/lib/security/workspace-cookie", () => ({
  resolveWorkspaceCookieSecret: () => "s",
  verifyWorkspaceCookie: () => "ws_abc12345",
}));
vi.mock("@/lib/db/runtime-config", () => ({ runtimeDatabaseUrl: () => null }));

import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";

describe("getInitiativeDetailCoherent in PGlite mode", () => {
  const fetchMock = vi.fn(async () => Response.json({ slug: "x" }));
  beforeEach(() => {
    process.env.DATA_PROVIDER = "db";
    process.env.PORT = "4010";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.DATA_PROVIDER; delete process.env.PORT; });

  it("fetches a fixed loopback origin, forwards only the workspace cookie, and times out", async () => {
    await getInitiativeDetailCoherent("x");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4010/initiatives/x/detail-data");
    expect((init.headers as Record<string, string>).cookie).toBe("jeeves_workspace=ws_abc12345.mac");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
