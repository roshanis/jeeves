// Decision dialog accessibility and limits (ui-intake-F40).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { reviewDecisionReadiness } from "@/lib/approval/review-readiness";

const mocks = vi.hoisted(() => ({ session: vi.fn(), decide: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...await original<typeof import("@/lib/client/api")>(),
  decide: mocks.decide,
}));
import { LiveActionsBar } from "@/components/jeeves/live-actions-bar";

const base = { token: "t", workspaceId: "w", expiresAt: Date.now() + 60_000, personaKey: "p", personaLabel: "P" };
const readiness = reviewDecisionReadiness({ state: "in_review", cycleOpen: true, requiredDomains: ["privacy-hipaa"], reviews: [{ domain: "privacy-hipaa", status: "drafted" }] });

beforeEach(() => vi.clearAllMocks());

describe("decision dialog (ui-intake-F40)", () => {
  function open() {
    mocks.session.mockReturnValue({ session: { ...base, role: "approver" }, logout: vi.fn() });
    renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="in_review" decisionReadiness={readiness} />);
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    fireEvent.click(document.querySelector('[data-slot="add-condition"]')!);
  }

  it("names condition inputs and remove buttons, and caps their length like the route", () => {
    open();
    const text = screen.getByRole("textbox", { name: "Condition 1 text" }) as HTMLInputElement;
    const control = screen.getByRole("textbox", { name: "Condition 1 control id" }) as HTMLInputElement;
    expect(text.maxLength).toBe(1000);
    expect(control.maxLength).toBe(50);
    expect(screen.getByRole("button", { name: "Remove condition 1" })).toBeTruthy();
  });

  it("disables Cancel while the decision is being recorded", async () => {
    mocks.decide.mockReturnValue(new Promise(() => {}));
    open();
    fireEvent.change(screen.getByRole("textbox", { name: "Condition 1 text" }), { target: { value: "Keep review" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Condition 1 control id" }), { target: { value: "C-01" } });
    fireEvent.click(document.querySelector('[data-slot="decide-confirm"]')!);
    await waitFor(() => expect(mocks.decide).toHaveBeenCalled());
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
