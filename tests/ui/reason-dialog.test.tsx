// ReasonDialog (components/jeeves/reason-dialog.tsx) — the shared
// mandatory-reason gate used by pause/resume and other audited admin actions.
// Contract: confirm is DISABLED until a non-empty (non-whitespace) reason is
// entered, so no admin action can be submitted without an audit reason.
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { ReasonDialog } from "@/components/jeeves/reason-dialog";
import { renderWithProviders } from "./helpers";

function renderDialog(onConfirm = vi.fn()) {
  renderWithProviders(
    <ReasonDialog
      open
      onOpenChange={() => {}}
      title="Pause deployment"
      description="Provide a reason — this is recorded in the audit log."
      confirmLabel="Pause"
      pendingLabel="Pausing…"
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("ReasonDialog", () => {
  it("disables confirm until a reason is entered", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("keeps confirm disabled for whitespace-only reasons", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    const confirm = screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("enables confirm once a real reason is present and passes the trimmed value", () => {
    const onConfirm = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  post-breach hold  " },
    });
    const confirm = screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("post-breach hold");
  });
});
