// A refused QC pass (REQUIRED_FOR_TIER gaps open) lists the gaps in the QC
// panel and points the Program Office to the existing return action; it is
// not a toast, and it does not look like a completed triage.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({
  runTriage: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh, replace: vi.fn() }),
  usePathname: () => "/initiatives/prior-auth-clinical-summarizer",
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

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
  return { ...actual, runTriage: mocks.runTriage };
});

const { ApiError } = await import("@/lib/client/api");
const { LiveActionsBar } = await import("@/components/jeeves/live-actions-bar");

function renderInQc() {
  return renderWithProviders(<LiveActionsBar initiativeId="init-1" isSeeded={false} state="in_qc" />);
}

describe("QC pass refused for open tier gaps", () => {
  beforeEach(() => {
    mocks.runTriage.mockReset();
    mocks.refresh.mockReset();
    mocks.toastError.mockReset();
  });

  it("lists the gaps and keeps Return to requester available", async () => {
    mocks.runTriage.mockRejectedValue(
      new ApiError(400, "cannot pass QC", [{ ruleId: "RFT-02", level: "REQUIRED_FOR_TIER", field: "data.retentionIntent", message: "Retention intent is required." }], "INTAKE_TIER_GAPS"),
    );
    renderInQc();
    fireEvent.click(screen.getByRole("button", { name: /run triage/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-slot")).toBe("qc-tier-gaps");
    expect(alert.textContent).toContain("RFT-02");
    expect(alert.textContent).toContain("Retention intent is required.");
    expect(alert.textContent).toContain("Return to requester");
    expect((screen.getAllByRole("button", { name: /return to requester/i })[0] as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("[data-slot=triage-result]")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("falls back to the toast when the refusal carries no readable gap", async () => {
    mocks.runTriage.mockRejectedValue(new ApiError(400, "cannot pass QC", [{ junk: true }], "INTAKE_TIER_GAPS"));
    renderInQc();
    fireEvent.click(screen.getByRole("button", { name: /run triage/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the toast for any other refusal", async () => {
    mocks.runTriage.mockRejectedValue(new ApiError(409, "already triaged"));
    renderInQc();
    fireEvent.click(screen.getByRole("button", { name: /run triage/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
