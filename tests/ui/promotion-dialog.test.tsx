// PromotionDialog (components/jeeves/promotion-dialog.tsx) — the mandatory
// 4-field attestation dialog gating POST /api/deployments/promotions/[id]/promote.
// Contract: confirm is DISABLED until ALL FOUR fields (feedbackDataSource,
// consentBasis, reviewedBy, reason) are non-empty after trim, mirroring
// reason-dialog.test.tsx's exact idiom for the single-field case.
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { PromotionDialog } from "@/components/jeeves/promotion-dialog";
import { renderWithProviders } from "./helpers";

function renderDialog(onConfirm = vi.fn()) {
  renderWithProviders(
    <PromotionDialog
      open
      onOpenChange={() => {}}
      initiativeTitle="Prior-Auth Clinical Summarizer"
      version="v2"
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

function fillField(dataSlot: string, value: string) {
  fireEvent.change(document.querySelector(`[data-slot="${dataSlot}"]`) as HTMLElement, {
    target: { value },
  });
}

function getConfirm(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Promote" }) as HTMLButtonElement;
}

describe("PromotionDialog", () => {
  it("disables confirm when the dialog first opens", () => {
    renderDialog();
    expect(getConfirm().disabled).toBe(true);
  });

  it("keeps confirm disabled with only 1-3 of the 4 fields filled", () => {
    renderDialog();
    fillField("promotion-feedback-data-source-input", "member feedback survey");
    expect(getConfirm().disabled).toBe(true);

    fillField("promotion-consent-basis-input", "opt-in consent form");
    expect(getConfirm().disabled).toBe(true);

    fillField("promotion-reviewed-by-input", "Angela Torres");
    // Still missing "reason" — 3 of 4 filled.
    expect(getConfirm().disabled).toBe(true);
  });

  it("keeps confirm disabled when a field is whitespace-only", () => {
    renderDialog();
    fillField("promotion-feedback-data-source-input", "member feedback survey");
    fillField("promotion-consent-basis-input", "opt-in consent form");
    fillField("promotion-reviewed-by-input", "Angela Torres");
    fillField("promotion-reason-input", "   ");
    expect(getConfirm().disabled).toBe(true);
  });

  it("enables confirm once all 4 fields are filled and fires onConfirm with trimmed values", () => {
    const onConfirm = renderDialog();
    fillField("promotion-feedback-data-source-input", "  member feedback survey  ");
    fillField("promotion-consent-basis-input", "  opt-in consent form  ");
    fillField("promotion-reviewed-by-input", "  Angela Torres  ");
    fillField("promotion-reason-input", "  quarterly RL checkpoint promotion  ");

    const confirm = getConfirm();
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      feedbackDataSource: "member feedback survey",
      consentBasis: "opt-in consent form",
      reviewedBy: "Angela Torres",
      reason: "quarterly RL checkpoint promotion",
    });
  });

  it("shows an inline error when provided", () => {
    renderWithProviders(
      <PromotionDialog
        open
        onOpenChange={() => {}}
        initiativeTitle="Prior-Auth Clinical Summarizer"
        version="v2"
        pending={false}
        error="already promoted"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("already promoted");
  });
});
