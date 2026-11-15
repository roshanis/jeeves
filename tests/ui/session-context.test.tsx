import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider, resetLiveSessionForTests, useLiveSession } from "@/lib/client/session-context";

const fetchMock = vi.fn();
let api: ReturnType<typeof useLiveSession>;

function Probe() {
  api = useLiveSession();
  return null;
}

function seed(personaKey: string, role: string, expiresAt = Date.now() + 60_000) {
  sessionStorage.setItem("jeeves_live_session", JSON.stringify({
    token: "tok-1", workspaceId: "ws", expiresAt, personaKey,
    personaLabel: personaKey === "public" ? "Public visitor" : "Marcus Webb", role,
  }));
}

function mount() {
  render(<RoleProvider><LiveSessionProvider><Probe /></LiveSessionProvider></RoleProvider>);
}

describe("LiveSessionProvider logout", () => {
  beforeEach(() => {
    resetLiveSessionForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("revokes a persona token on the server, best-effort, then clears the session (auth-F19)", () => {
    seed("marcus-webb", "reviewer");
    mount();
    act(() => api.logout());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/session");
    expect(init).toMatchObject({ method: "DELETE", keepalive: true, headers: { Authorization: "Bearer tok-1" } });
    expect(api.session).toBeNull();
  });

  it("still logs out when the revoke request fails", () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    seed("marcus-webb", "reviewer");
    mount();
    act(() => api.logout());
    expect(api.session).toBeNull();
  });

  it("sends nothing for a public session", () => {
    seed("public", "public");
    mount();
    act(() => api.logout());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.session).toBeNull();
  });
});
