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

function renderChip() {
  return renderWithProviders(
    <LiveSessionProvider>
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
  it("starts in read-only mode", () => {
    renderChip();
    expect(screen.getByText("Read-only (public)")).toBeTruthy();
  });

  it("lists all 9 personas grouped by role in the dialog", () => {
    renderChip();
    fireEvent.click(screen.getByText("Read-only (public)"));
    const select = document.querySelector(
      '[data-slot="persona-select"]',
    ) as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(9);
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
