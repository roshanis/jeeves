import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";
import { RoleSwitcher } from "@/components/jeeves/role-switcher";

const fetchMock = vi.fn();
beforeEach(() => { resetLiveSessionForTests(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); resetLiveSessionForTests(); });
function show(liveModeAvailable = true) { return renderWithProviders(<LiveSessionProvider liveModeAvailable={liveModeAvailable}><DemoModeChip /><RoleSwitcher /></LiveSessionProvider>); }
function response() { return new Response(JSON.stringify({ token: "test-live-token", workspaceId: "test-workspace", expiresAt: Date.now() + 60_000 })); }

describe("DemoModeChip", () => {
  it("keeps entry disabled in preview mode without offering a password dialog", () => {
    show(false);
    const preview = screen.getByRole("button", { name: "Read-only preview" });
    expect(preview).toHaveProperty("disabled", true);
    expect(preview.getAttribute("title")).toContain("preview is read-only");
    fireEvent.click(preview);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("does not read or delete a stored live session while showing a preview", () => {
    const saved = JSON.stringify({ token: "tok-live", workspaceId: "ws-1", expiresAt: Date.now() + 60_000, personaKey: "priya-raman", personaLabel: "Priya Raman", role: "requester" });
    sessionStorage.setItem("jeeves_live_session", saved);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    show(false);
    expect(screen.getByRole("button", { name: "Read-only preview" })).toBeTruthy();
    expect(screen.queryByText("Live demo (session workspace)")).toBeNull();
    expect(getItem).not.toHaveBeenCalledWith("jeeves_live_session");
    expect(sessionStorage.getItem("jeeves_live_session")).toBe(saved);
    getItem.mockRestore();
  });

  it("shows the preview limitation if the server stops allowing live entry", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "This preview is read-only. Open an interactive demo workspace to save changes." }), { status: 403 }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Start demo" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveProperty("textContent", "This preview is read-only. Open an interactive demo workspace to save changes."));
  });

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
