import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider, resetLiveSessionForTests, useLiveSession } from "@/lib/client/session-context";
import { TryDemoButton } from "@/components/jeeves/try-demo-button";
import MarketingLayout from "@/app/(marketing)/layout";
import ConsoleLayout from "@/app/(console)/layout";
import RootLayout from "@/app/layout";

const { push, fetchMock } = vi.hoisted(() => ({ push: vi.fn(), fetchMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "--font-mock" }) }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/jeeves/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/jeeves/app-topbar", () => ({ AppTopBar: () => null }));
vi.mock("@/components/jeeves/app-mobile-nav", () => ({ AppMobileNav: () => null }));
vi.mock("@/components/jeeves/console-top-bar", () => ({ ConsoleTopBar: () => null }));
beforeEach(() => { resetLiveSessionForTests(); push.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function show(liveModeAvailable = true) { render(<RoleProvider><LiveSessionProvider liveModeAvailable={liveModeAvailable}><TryDemoButton /></LiveSessionProvider></RoleProvider>); }

function SessionProbe({ personaKey }: { personaKey: string }) {
  const { login, pending, session } = useLiveSession();
  return <>
    <output data-testid="session-state">{`${pending ? "pending" : "idle"}|${session?.personaKey ?? "public"}`}</output>
    <button onClick={() => void login(personaKey).catch(() => {})}>Choose persona</button>
  </>;
}

describe("visitor entry", () => {
  it("disables landing entry in preview mode without making a request", () => {
    show(false);
    const button = screen.getByRole("button", { name: "Try the demo" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText(/preview is read-only/)).toBeTruthy();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["db", "mock"])("the root layout supplies runtime %s capability", async (mode) => {
    vi.stubEnv("DATA_PROVIDER", mode);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "test-token", workspaceId: "test-workspace", expiresAt: Date.now() + 60_000 })));
    render(<RootLayout><MarketingLayout><p>Visitor landing</p></MarketingLayout></RootLayout>);
    const button = screen.getByRole("button", { name: "Try the demo" });
    expect(button).toHaveProperty("disabled", mode === "mock");
    fireEvent.click(button);
    if (mode === "db") await waitFor(() => expect(push).toHaveBeenCalledWith("/initiatives/new"));
    else expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares a pending entry across marketing and console navigation before switching personas", async () => {
    const responses: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => responses.push(resolve)));
    const view = render(<RootLayout><MarketingLayout><SessionProbe personaKey="priya-raman" /></MarketingLayout></RootLayout>);
    fireEvent.click(screen.getByRole("button", { name: "Choose persona" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(<RootLayout><ConsoleLayout><SessionProbe personaKey="marcus-webb" /></ConsoleLayout></RootLayout>);
    expect(screen.getByTestId("session-state").textContent).toBe("pending|public");
    fireEvent.click(screen.getByRole("button", { name: "Choose persona" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => responses[0]!(new Response(JSON.stringify({ token: "requester-token", workspaceId: "visitor-workspace", expiresAt: Date.now() + 60_000 }))));
    expect(screen.getByTestId("session-state").textContent).toBe("idle|priya-raman");

    fireEvent.click(screen.getByRole("button", { name: "Choose persona" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer requester-token");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ personaKey: "marcus-webb" });
    await act(async () => responses[1]!(new Response(JSON.stringify({ token: "reviewer-token", workspaceId: "visitor-workspace", expiresAt: Date.now() + 60_000 }))));
    view.rerender(<RootLayout><MarketingLayout><SessionProbe personaKey="priya-raman" /></MarketingLayout></RootLayout>);
    expect(screen.getByTestId("session-state").textContent).toBe("idle|marcus-webb");
    expect(JSON.parse(sessionStorage.getItem("jeeves_live_session")!)).toMatchObject({ personaKey: "marcus-webb", workspaceId: "visitor-workspace" });
  });

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
