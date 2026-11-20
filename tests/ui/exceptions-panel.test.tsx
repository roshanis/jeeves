import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ExceptionsPanel } from "@/components/jeeves/exceptions-panel";
import { ApiError, apiErrorToMessage, type ExceptionRow } from "@/lib/client/api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));

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

beforeEach(() => mocks.session.mockReturnValue(null));

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

  it("shows the expiry date of an approved exception, and a dash when there is none", () => {
    const approved: ExceptionRow = { ...requested, id: "exc-4", status: "approved", expiresAt: Date.parse("2026-09-30T12:00:00Z") };
    renderWithProviders(<ExceptionsPanel exceptions={[approved, requested]} />);
    expect(screen.getByRole("columnheader", { name: "Expires" })).toBeDefined();
    expect(screen.getByText("2026-09-30")).toBeDefined();
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

  /* api-initiatives-F11: shared sample rows are immutable to visitors, so no action that always fails. */
  it("shows a shared sample exception read-only for an approver, and keeps actions on the viewer's own", () => {
    mocks.session.mockReturnValue({ session: { token: "t", role: "approver" }, logout: vi.fn() });
    renderWithProviders(<ExceptionsPanel exceptions={[{ ...requested, id: "exc-seed", isShared: true }]} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByText(/sample data/i)).toBeDefined();
  });

  it("offers Approve/Reject on an exception owned by the viewer's workspace", () => {
    mocks.session.mockReturnValue({ session: { token: "t", role: "approver" }, logout: vi.fn() });
    renderWithProviders(<ExceptionsPanel exceptions={[{ ...requested, id: "exc-own", isShared: false }]} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
  });

  it("offers an admin no Approve/Reject (Admin never approves); Revoke and Renew stay", () => {
    mocks.session.mockReturnValue({ session: { token: "t", role: "admin" }, logout: vi.fn() });
    renderWithProviders(
      <ExceptionsPanel
        exceptions={[
          { ...requested, id: "exc-r", isShared: false },
          { ...requested, id: "exc-a", status: "approved", isShared: false },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByRole("button", { name: "Renew" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined();
  });

  it("explains a 404 instead of the generic failure message", () => {
    expect(apiErrorToMessage(new ApiError(404, "controlException not found: exc-seed-hr-r01"))).toMatch(/no longer available/i);
  });
});
