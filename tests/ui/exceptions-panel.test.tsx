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

  /* -------------------------------------------------------------------------
   * External-review finding #5: approving a renewal atomically supersedes
   * the original exception it renews (lib/services/exception-service.ts). The
   * client-side status union and badge map need a 'superseded' entry, and an
   * unrecognized status string must render (not crash).
   * ---------------------------------------------------------------------- */
  it("renders a 'superseded' exception with its own badge, no action buttons", () => {
    const superseded: ExceptionRow = { ...requested, id: "exc-2", status: "superseded" };
    renderWithProviders(<ExceptionsPanel exceptions={[superseded]} />);
    expect(screen.getByText("Superseded")).toBeDefined();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Revoke")).toBeNull();
  });

  it("does not crash on a status the client doesn't recognize — renders the raw value instead", () => {
    const unknown = { ...requested, id: "exc-3", status: "some-future-status" } as unknown as ExceptionRow;
    expect(() => renderWithProviders(<ExceptionsPanel exceptions={[unknown]} />)).not.toThrow();
    expect(screen.getByText("some-future-status")).toBeDefined();
  });
});
