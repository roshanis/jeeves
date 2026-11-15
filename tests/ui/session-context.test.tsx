import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { IntakeForm } from "@/components/jeeves/intake-form";
import { LiveSessionProvider, resetLiveSessionForTests, useLiveSession } from "@/lib/client/session-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const fetchMock = vi.fn();
const probe: { api: ReturnType<typeof useLiveSession> } = { api: null as never };

function Probe() {
  const value = useLiveSession();
  React.useEffect(() => { probe.api = value; });
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
    act(() => probe.api.logout());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/session");
    expect(init).toMatchObject({ method: "DELETE", keepalive: true, headers: { Authorization: "Bearer tok-1" } });
    expect(probe.api.session).toBeNull();
  });

  it("still logs out when the revoke request fails", () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    seed("marcus-webb", "reviewer");
    mount();
    act(() => probe.api.logout());
    expect(probe.api.session).toBeNull();
  });

  it("sends nothing for a public session", () => {
    seed("public", "public");
    mount();
    act(() => probe.api.logout());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe.api.session).toBeNull();
  });
});

describe("session expiry notice (ui-intake-F31)", () => {
  beforeEach(() => {
    resetLiveSessionForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  const notices = () => screen.getByText(/session expired/i).closest("[role='status']") as HTMLElement;

  function mountForm() {
    render(<RoleProvider><LiveSessionProvider><Probe /><IntakeForm /></LiveSessionProvider></RoleProvider>);
  }

  it("says the session expired, names the matching door, and does not mint anything", () => {
    seed("public", "public", Date.now() + 1000);
    mountForm();
    expect(screen.queryByText(/session expired/i)).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(probe.api.session).toBeNull();
    expect(screen.getByText(/session expired/i)).toBeTruthy();
    const notice = within(notices());
    expect(notice.getByText(/Send a real request/)).toBeTruthy();
    expect(notice.queryByText(/Start the demo/)).toBeNull();
    expect(probe.api.expired).toEqual({ kind: "public" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps what the visitor typed and says so only when something was typed", () => {
    seed("public", "public", Date.now() + 1000);
    mountForm();
    fireEvent.change(screen.getByLabelText("Initiative title"), { target: { value: "My typed title" } });
    act(() => { vi.advanceTimersByTime(1500); });
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("My typed title");
    expect(notices().textContent).toMatch(/What you typed is still on this page/);
  });

  it("does not claim typed content on an untouched form", () => {
    seed("public", "public", Date.now() + 1000);
    mountForm();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/session expired/i)).toBeTruthy();
    expect(notices().textContent).not.toMatch(/What you typed/);
  });

  it("names the demo door when a persona session expired", () => {
    seed("marcus-webb", "reviewer", Date.now() + 1000);
    mountForm();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(probe.api.expired).toEqual({ kind: "persona" });
    const notice = within(notices());
    expect(notice.getByText(/Start the demo/)).toBeTruthy();
    expect(notice.queryByText(/Send a real request/)).toBeNull();
  });

  it("does not bring the old notice back when a later session is dropped by a 401", async () => {
    seed("public", "public", Date.now() + 1000);
    mountForm();
    act(() => { vi.advanceTimersByTime(1500); });
    fetchMock.mockResolvedValueOnce(Response.json({ token: "t2", workspaceId: "w2", expiresAt: Date.now() + 60_000, expiresInMs: 60_000 }));
    await act(async () => { await probe.api.login("marcus-webb"); });
    expect(probe.api.session?.token).toBe("t2");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "session expired or invalid" }, { status: 401 }));
    await act(async () => { await probe.api.login("priya-raman").catch(() => {}); });
    expect(probe.api.session).toBeNull();
    expect(probe.api.expired).toBeNull();
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });

  it("shows no notice on a first visit or after a deliberate logout", () => {
    mountForm();
    expect(screen.queryByText(/session expired/i)).toBeNull();
    cleanup();
    seed("marcus-webb", "reviewer");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    mountForm();
    act(() => probe.api.logout());
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(probe.api.expired).toBeNull();
  });

  it("clears the notice as soon as a new session starts", async () => {
    seed("public", "public", Date.now() + 1000);
    mountForm();
    act(() => { vi.advanceTimersByTime(1500); });
    fetchMock.mockResolvedValue(Response.json({ token: "t2", workspaceId: "public-w", expiresAt: Date.now() + 60_000, expiresInMs: 60_000 }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send a real request" })); });
    expect(probe.api.session?.token).toBe("t2");
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
});
