import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ExceptionsPanel } from "@/components/jeeves/exceptions-panel";
import type { ExceptionRow } from "@/lib/client/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const requested: ExceptionRow = {
  id: "exc-1",
  controlId: "R-01",
  effectiveControlId: "ec-1",
  initiativeId: "init-11",
  status: "requested",
  reason: "Waive the semi-annual bias-audit cadence for this cycle.",
  requestedBy: "nia-okafor",
  requestedAt: "2026-06-13T00:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  expiresAt: null,
  supersedesId: null,
};

describe("ExceptionsPanel", () => {
  it("renders exceptions read-only for a public (no session) viewer — no action buttons", () => {
    renderWithProviders(<ExceptionsPanel exceptions={[requested]} />);
    expect(screen.getByText("Control exceptions")).toBeDefined();
    expect(screen.getByText("R-01")).toBeDefined();
    expect(screen.getByText("Requested")).toBeDefined();
    // No live session -> no approver actions.
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
  });

  it("shows an empty state when there are no exceptions", () => {
    renderWithProviders(<ExceptionsPanel exceptions={[]} />);
    expect(screen.getByText("No control exceptions on file.")).toBeDefined();
  });
});
