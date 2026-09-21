import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { TryDemoButton } from "@/components/jeeves/try-demo-button";

const { push, fetchMock } = vi.hoisted(() => ({ push: vi.fn(), fetchMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
beforeEach(() => { resetLiveSessionForTests(); push.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() { render(<RoleProvider><LiveSessionProvider><TryDemoButton /></LiveSessionProvider></RoleProvider>); }

describe("visitor entry", () => {
  it("one click starts a requester workspace and opens an editable intake", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "test-token", workspaceId: "test-workspace", expiresAt: Date.now() + 60_000 })));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/initiatives/new"));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ personaKey: "priya-raman" });
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps a visible retry when starting the demo fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/rate limit/i));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try the demo" })).toHaveProperty("disabled", false);
  });
});
