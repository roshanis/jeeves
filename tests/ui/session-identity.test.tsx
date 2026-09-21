import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoleProvider, useRole } from "@/components/jeeves/role-context";
import { RoleSwitcher } from "@/components/jeeves/role-switcher";
import {
  LiveSessionProvider,
  resetLiveSessionForTests,
  useLiveSession,
} from "@/lib/client/session-context";

const fetchMock = vi.fn();

function IdentityProbe() {
  const { personaKey } = useRole();
  const { session } = useLiveSession();
  return <p>{`${personaKey}|${session?.personaKey ?? "public"}`}</p>;
}

function Harness() {
  return (
    <RoleProvider>
      <LiveSessionProvider>
        <IdentityProbe />
        <RoleSwitcher />
      </LiveSessionProvider>
    </RoleProvider>
  );
}

describe("live session identity", () => {
  beforeEach(() => {
    resetLiveSessionForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores the exact persona and lets visitors switch roles", async () => {
    sessionStorage.setItem(
      "jeeves_live_session",
      JSON.stringify({
        token: "tok",
        workspaceId: "ws",
        expiresAt: Date.now() + 60_000,
        personaKey: "marcus-webb",
        personaLabel: "Marcus Webb",
        role: "reviewer",
      }),
    );
    render(<Harness />);

    await waitFor(() => expect(screen.getByText("marcus-webb|marcus-webb")).toBeTruthy());
    expect(screen.getByRole("combobox", { name: "Demo persona" })).toHaveProperty(
      "disabled",
      false,
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token: "new-token", workspaceId: "ws", expiresAt: Date.now() + 60_000 })));
    fireEvent.change(screen.getByRole("combobox", { name: "Demo persona" }), { target: { value: "angela-torres" } });
    await waitFor(() => expect(screen.getByText("angela-torres|angela-torres")).toBeTruthy());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ personaKey: "angela-torres" });
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("authorization")).toBe("Bearer tok");
  });

  it("expires an authenticated session at expiresAt", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(
      "jeeves_live_session",
      JSON.stringify({
        token: "tok",
        workspaceId: "ws",
        expiresAt: Date.now() + 1_000,
        personaKey: "marcus-webb",
        personaLabel: "Marcus Webb",
        role: "reviewer",
      }),
    );
    render(<Harness />);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(screen.getByText("marcus-webb|public")).toBeTruthy();
  });
});
