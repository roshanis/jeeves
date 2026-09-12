// Returning an intake from QC collects the reason in the app, not in a
// browser prompt.
//
// The reason is the only thing that tells the requester what to fix, and it
// lands on the append-only audit trail — so it is worth a real field.
// `window.prompt` is a single unstyled line, blocked outright in some
// contexts (and in the Playwright run unless a handler is registered), and
// gives no way to show the server's error back to the person who typed it.
// The codebase already has ReasonDialog for exactly this shape of action
// (admin pause/resume, review return); QC return uses it too rather than a
// fourth variation.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({
  returnFromQc: vi.fn(),
  startQc: vi.fn(),
  runTriage: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh, replace: vi.fn() }),
  usePathname: () => "/initiatives/prior-auth-clinical-summarizer",
}));

vi.mock("@/lib/client/use-live-info", () => ({
  useLiveInfo: () => ({ initiativeId: "init-1", cycleId: null }),
}));

const SESSION = {
  token: "tok",
  workspaceId: "ws-1",
  expiresAt: Date.now() + 60_000,
  personaKey: "nia-okafor",
  personaLabel: "Nia Okafor",
  role: "program" as const,
};

vi.mock("@/lib/client/session-context", () => ({
  useLiveSessionOptional: () => ({ session: SESSION, logout: vi.fn() }),
  useLiveSession: () => ({ session: SESSION, logout: vi.fn() }),
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return {
    ...actual,
    startQc: mocks.startQc,
    runTriage: mocks.runTriage,
    returnFromQc: mocks.returnFromQc,
  };
});

const { LiveActionsBar } = await import("@/components/jeeves/live-actions-bar");

function renderInQc() {
  return renderWithProviders(
    <LiveActionsBar slug="prior-auth-clinical-summarizer" state="in_qc" />,
  );
}

describe("QC return — reason collected in-app", () => {
  beforeEach(() => {
    mocks.returnFromQc.mockReset();
    mocks.returnFromQc.mockResolvedValue({ state: "intake_draft", reason: "x" });
    mocks.refresh.mockReset();
  });

  it("never reaches for window.prompt", async () => {
    const prompt = vi.spyOn(window, "prompt");
    renderInQc();

    fireEvent.click(screen.getByRole("button", { name: /return to requester/i }));

    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("opens a dialog with a reason field", () => {
    renderInQc();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /return to requester/i }));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText(/reason \(required\)/i)).toBeDefined();
  });

  it("will not submit an empty reason — the server would 400, and the requester would learn nothing", () => {
    renderInQc();
    fireEvent.click(screen.getByRole("button", { name: /return to requester/i }));

    const button = document.querySelector<HTMLButtonElement>(
      '[data-slot="admin-reason-confirm"]',
    );
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(mocks.returnFromQc).not.toHaveBeenCalled();
  });

  it("sends the typed reason through to the API and refreshes", async () => {
    renderInQc();
    fireEvent.click(screen.getByRole("button", { name: /return to requester/i }));

    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-slot="admin-reason-input"]',
    )!;
    fireEvent.change(input, {
      target: { value: "  Data sources list is empty.  " },
    });

    const button = document.querySelector<HTMLButtonElement>(
      '[data-slot="admin-reason-confirm"]',
    )!;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(mocks.returnFromQc).toHaveBeenCalledTimes(1));
    // Trimmed: the service rejects a whitespace-only reason, and stray
    // padding has no business on the audit trail.
    expect(mocks.returnFromQc).toHaveBeenCalledWith(
      "tok",
      "init-1",
      "Data sources list is empty.",
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});
