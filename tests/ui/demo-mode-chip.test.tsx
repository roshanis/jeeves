// Demo mode chip + passcode dialog (ui-spec §8.3): read-only chip opens the
// passcode/persona dialog; 401 shows an inline error without closing; a
// successful login flips to "Live demo (session workspace)" and "Reset to
// read-only" drops back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import {
  LiveSessionProvider,
  resetLiveSessionForTests,
} from "@/lib/client/session-context";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";

const fetchMock = vi.fn();

beforeEach(() => {
  resetLiveSessionForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLiveSessionForTests();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderChip(liveModeAvailable = true) {
  return renderWithProviders(
    <LiveSessionProvider liveModeAvailable={liveModeAvailable}>
      <DemoModeChip />
    </LiveSessionProvider>,
  );
}

function openDialogAndFill(passcode: string, personaKey = "priya-raman") {
  fireEvent.click(screen.getByText("Read-only (public)"));
  fireEvent.change(
    document.querySelector('[data-slot="passcode-input"]') as HTMLInputElement,
    { target: { value: passcode } },
  );
  fireEvent.change(
    document.querySelector('[data-slot="persona-select"]') as HTMLSelectElement,
    { target: { value: personaKey } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Enter live mode" }));
}

describe("DemoModeChip", () => {
  it("explains read-only preview mode without offering an unusable passcode form", () => {
    renderChip(false);
    fireEvent.click(screen.getByRole("button", { name: "Read-only preview" }));
    expect(screen.getByRole("dialog", { name: "Explore the read-only preview" })).toBeTruthy();
    expect(screen.getByText(/preview is read-only/)).toBeTruthy();
    expect(screen.queryByLabelText("Demo passcode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter live mode" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not read or delete a stored live session while showing a preview", () => {
    const saved = JSON.stringify({ token: "tok-live", workspaceId: "ws-1", expiresAt: Date.now() + 60_000, personaKey: "priya-raman", personaLabel: "Priya Raman", role: "requester" });
    sessionStorage.setItem("jeeves_live_session", saved);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    renderChip(false);
    expect(screen.getByRole("button", { name: "Read-only preview" })).toBeTruthy();
    expect(screen.queryByText("Live demo (session workspace)")).toBeNull();
    expect(getItem).not.toHaveBeenCalledWith("jeeves_live_session");
    expect(sessionStorage.getItem("jeeves_live_session")).toBe(saved);
    getItem.mockRestore();
  });

  it("shows the server's preview limitation if live mode becomes unavailable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "This preview is read-only. Open an interactive demo workspace to save changes." }));
    renderChip();
    openDialogAndFill("correct-pass");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveProperty("textContent", "This preview is read-only. Open an interactive demo workspace to save changes."));
    expect(screen.getByText("Read-only (public)")).toBeTruthy();
  });

  it("starts in read-only mode", () => {
    renderChip();
    expect(screen.getByText("Read-only (public)")).toBeTruthy();
  });

  it("lists all 13 personas grouped by role in the dialog", () => {
    renderChip();
    fireEvent.click(screen.getByText("Read-only (public)"));
    const select = document.querySelector(
      '[data-slot="persona-select"]',
    ) as HTMLSelectElement;
    // 13 = 2 requesters + 8 domain reviewers + approver + admin + program.
    expect(select.querySelectorAll("option")).toHaveLength(13);
    expect(select.querySelectorAll("optgroup")).toHaveLength(5);
  });

  it("shows an inline error on 401 and keeps the dialog open", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
    renderChip();
    openDialogAndFill("wrong-pass");

    await waitFor(() => {
      expect(screen.getByText("Incorrect passcode — try again.")).toBeTruthy();
    });
    // Dialog still open (passcode input still in the DOM).
    expect(document.querySelector('[data-slot="passcode-input"]')).toBeTruthy();
    // Still read-only.
    expect(screen.getByText("Read-only (public)")).toBeTruthy();
  });

  it("flips to live mode on success and resets back to read-only", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: "tok-live",
        workspaceId: "ws-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    renderChip();
    openDialogAndFill("correct-pass", "elena-vasquez");

    await waitFor(() => {
      expect(screen.getByText("Live demo (session workspace)")).toBeTruthy();
    });
    expect(screen.getByText("Dr. Elena Vasquez")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset to read-only" }));
    await waitFor(() => {
      expect(screen.getByText("Read-only (public)")).toBeTruthy();
    });
  });
});
