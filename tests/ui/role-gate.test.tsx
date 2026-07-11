import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEMO_PASSCODE_TOOLTIP,
  GatedActionButton,
} from "@/components/jeeves/role-gate";
import { RoleProvider, useRole } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

function SwitchToAdmin() {
  const { setRoleKey } = useRole();
  return (
    <button type="button" onClick={() => setRoleKey("admin")}>
      switch-to-admin
    </button>
  );
}

function Harness() {
  return (
    <RoleProvider>
      <TooltipProvider>
        <SwitchToAdmin />
        <GatedActionButton label="Sign" />
      </TooltipProvider>
    </RoleProvider>
  );
}

/** The actual <button data-slot="button"> nodes labeled "Sign". */
function signButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[data-slot="button"]'),
  ).filter((b) => b.textContent === "Sign");
}

describe("RoleGate mechanisms", () => {
  it("uses the exact auth-gating tooltip string", () => {
    expect(DEMO_PASSCODE_TOOLTIP).toBe("Enter demo passcode to enable");
  });

  it("renders sign-style actions disabled-with-tooltip for non-admin roles", () => {
    const { container } = render(<Harness />);
    const buttons = signButtons(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(true);
  });

  it("hides sign-style actions entirely (no DOM node) for the Admin role", () => {
    const { container } = render(<Harness />);
    expect(signButtons(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "switch-to-admin" }));

    expect(signButtons(container)).toHaveLength(0);
  });
});
