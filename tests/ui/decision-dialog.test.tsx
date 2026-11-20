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

  describe("rejection reason (domain-F10)", () => {
    const rejectable = reviewDecisionReadiness({ state: "in_review", cycleOpen: true, requiredDomains: ["privacy-hipaa"], reviews: [{ domain: "privacy-hipaa", status: "pending" }] });
    function openReject() {
      mocks.session.mockReturnValue({ session: { ...base, role: "approver" }, logout: vi.fn() });
      renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="in_review" decisionReadiness={rejectable} />);
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
      fireEvent.change(document.querySelector('[data-slot="decide-select"]')!, { target: { value: "rejected" } });
    }
    const confirm = () => document.querySelector('[data-slot="decide-confirm"]') as HTMLButtonElement;

    it("keeps the confirm button disabled until a reason is typed, then sends it trimmed", async () => {
      mocks.decide.mockResolvedValue({ type: "rejected", after: "rejected" });
      openReject();
      expect(confirm().disabled).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: /reason for rejecting/i }), { target: { value: "   " } });
      expect(confirm().disabled).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: /reason for rejecting/i }), { target: { value: "  Unconsented use of member data.  " } });
      expect(confirm().disabled).toBe(false);
      fireEvent.click(confirm());
      await waitFor(() => expect(mocks.decide).toHaveBeenCalled());
      expect(mocks.decide.mock.calls[0]![2]).toMatchObject({ decision: "rejected", reason: "Unconsented use of member data." });
    });

    it("caps the reason at 2,000 characters like the route", () => {
      openReject();
      expect((screen.getByRole("textbox", { name: /reason for rejecting/i }) as HTMLTextAreaElement).maxLength).toBe(2000);
    });

    it("shows no reason field, and sends none, for an approval", async () => {
      mocks.decide.mockResolvedValue({ type: "approved", after: "approved" });
      mocks.session.mockReturnValue({ session: { ...base, role: "approver" }, logout: vi.fn() });
      const approvable = reviewDecisionReadiness({ state: "in_review", cycleOpen: true, requiredDomains: ["privacy-hipaa"], reviews: [{ domain: "privacy-hipaa", status: "signed" }] });
      renderWithProviders(<LiveActionsBar initiativeId="i" isSeeded={false} state="in_review" decisionReadiness={approvable} />);
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
      expect(screen.queryByRole("textbox", { name: /reason for rejecting/i })).toBeNull();
      fireEvent.click(confirm());
      await waitFor(() => expect(mocks.decide).toHaveBeenCalled());
      expect(mocks.decide.mock.calls[0]![2]).not.toHaveProperty("reason");
    });
  });
});
