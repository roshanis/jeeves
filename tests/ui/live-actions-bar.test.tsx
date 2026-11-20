// QC buttons for Admin (ui-intake-F41).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({ session: vi.fn(), decide: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...await original<typeof import("@/lib/client/api")>(),
  decide: mocks.decide,
}));
import { LiveActionsBar } from "@/components/jeeves/live-actions-bar";

const base = { token: "t", workspaceId: "w", expiresAt: Date.now() + 60_000, personaKey: "p", personaLabel: "P" };

beforeEach(() => vi.clearAllMocks());

describe("QC buttons for Admin (ui-intake-F41)", () => {
  it("enables Open QC and Return to requester for an admin session, as the transition table allows", () => {
    mocks.session.mockReturnValue({ session: { ...base, role: "admin" }, logout: vi.fn() });
    const { unmount } = renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="submitted" />);
    expect((screen.getByRole("button", { name: "Open QC" }) as HTMLButtonElement).getAttribute("aria-disabled")).toBeNull();
    unmount();
    renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="in_qc" />);
    expect(screen.getByRole("button", { name: "Return to requester" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("still disables them for a reviewer", () => {
    mocks.session.mockReturnValue({ session: { ...base, role: "reviewer" }, logout: vi.fn() });
    renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="submitted" />);
    expect(screen.getByRole("button", { name: "Open QC" }).getAttribute("aria-disabled")).toBe("true");
  });
});
