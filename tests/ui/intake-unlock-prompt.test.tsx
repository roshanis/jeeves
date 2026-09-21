import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { IntakeForm } from "@/components/jeeves/intake-form";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/initiatives/new" }));
beforeEach(() => resetLiveSessionForTests());
afterEach(() => vi.unstubAllGlobals());
function show() { renderWithProviders(<LiveSessionProvider><DemoModeChip /><IntakeForm /></LiveSessionProvider>); }

describe("intake entry", () => {
  it("starts a requester session from the form with no dialog or password", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-token", workspaceId: "test-workspace", expiresAt: Date.now() + 60_000 }))));
    show();
    const start = screen.getByRole("button", { name: "Start the demo" });
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText("Live demo (session workspace)")).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it("requires a session before submission", () => {
    show();
    expect(screen.getAllByRole("button", { name: /submit intake/i })[0]).toHaveProperty("disabled", true);
  });
});
