// RollbackDialog (components/jeeves/rollback-dialog.tsx) — the reason-gated
// confirmation dialog for POST /api/deployments/[id]/rollback. Contract:
// confirm is DISABLED until a target version is selected AND reason is
// non-empty after trim, mirroring promotion-dialog.test.tsx's idiom.
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { RollbackDialog } from "@/components/jeeves/rollback-dialog";
import { renderWithProviders } from "./helpers";

const TARGETS = [
  { deploymentVersionId: "dep-1", version: "v1.9" },
  { deploymentVersionId: "dep-0", version: "v1.8" },
];

function renderDialog(onConfirm = vi.fn(), targets = TARGETS) {
  renderWithProviders(
    <RollbackDialog
      open
      onOpenChange={() => {}}
      initiativeTitle="Prior-Auth Correspondence Drafting Model"
      currentVersion="v2.0"
      targets={targets}
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

function getConfirm(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Roll back" }) as HTMLButtonElement;
}

describe("RollbackDialog", () => {
  it("disables confirm when the reason is empty (target defaults to the first option)", () => {
    renderDialog();
    expect(getConfirm().disabled).toBe(true);
  });

  it("keeps confirm disabled when the reason is whitespace-only", () => {
    renderDialog();
    fireEvent.change(document.querySelector('[data-slot="rollback-reason-input"]') as HTMLElement, {
      target: { value: "   " },
    });
    expect(getConfirm().disabled).toBe(true);
  });

  it("disables confirm when there are no target versions available", () => {
    renderDialog(vi.fn(), []);
    expect(getConfirm().disabled).toBe(true);
  });

  it("enables confirm once a target is selected and reason is non-empty, and fires onConfirm with trimmed reason", () => {
    const onConfirm = renderDialog();
    fireEvent.change(document.querySelector('[data-slot="rollback-target-select"]') as HTMLElement, {
      target: { value: "dep-0" },
    });
    fireEvent.change(document.querySelector('[data-slot="rollback-reason-input"]') as HTMLElement, {
      target: { value: "  regression found in v2.0  " },
    });

    const confirm = getConfirm();
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      targetDeploymentVersionId: "dep-0",
      reason: "regression found in v2.0",
    });
  });

  it("shows an inline error when provided", () => {
    renderWithProviders(
      <RollbackDialog
        open
        onOpenChange={() => {}}
        initiativeTitle="Prior-Auth Correspondence Drafting Model"
        currentVersion="v2.0"
        targets={TARGETS}
        pending={false}
        error="no prior version"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("no prior version");
  });
});
