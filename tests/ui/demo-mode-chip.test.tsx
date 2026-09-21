import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";
import { RoleSwitcher } from "@/components/jeeves/role-switcher";

const fetchMock = vi.fn();
beforeEach(() => { resetLiveSessionForTests(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); resetLiveSessionForTests(); });
function show() { return renderWithProviders(<LiveSessionProvider><DemoModeChip /><RoleSwitcher /></LiveSessionProvider>); }
function response() { return new Response(JSON.stringify({ token: "test-live-token", workspaceId: "test-workspace", expiresAt: Date.now() + 60_000 })); }

describe("DemoModeChip", () => {
  it("offers immediate entry and all 13 personas without a password dialog", () => {
    show();
    expect(screen.getByRole("button", { name: "Start demo" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(13);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it("starts once on a double click and can exit back to browsing", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    show();
    const start = screen.getByRole("button", { name: "Start demo" });
    fireEvent.click(start); fireEvent.click(start);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(response());
    await waitFor(() => expect(screen.getByText("Live demo (session workspace)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(screen.getByRole("button", { name: "Start demo" })).toBeTruthy();
  });
  it("shows entry failures and leaves a retry available", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    show(); fireEvent.click(screen.getByRole("button", { name: "Start demo" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Start demo" })).toHaveProperty("disabled", false);
  });
});
