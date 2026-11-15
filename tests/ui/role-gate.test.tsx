import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEMO_SESSION_TOOLTIP,
  GatedActionButton,
} from "@/components/jeeves/role-gate";
import { RoleProvider, useRole } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";

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

function describedBy(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("RoleGate mechanisms", () => {
  it("uses the exact auth-gating tooltip string", () => {
    expect(DEMO_SESSION_TOOLTIP).toBe("Start the demo to try this action");
  });

  it("renders sign-style actions disabled-with-tooltip for non-admin roles", () => {
    const { container } = render(<Harness />);
    const buttons = signButtons(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-disabled")).toBe("true");
  });

  it("hides sign-style actions entirely (no DOM node) for the Admin role", () => {
    const { container } = render(<Harness />);
    expect(signButtons(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "switch-to-admin" }));

    expect(signButtons(container)).toHaveLength(0);
  });

  it("keeps live actions disabled for a public (real request) session", () => {
    resetLiveSessionForTests();
    sessionStorage.setItem("jeeves_live_session", JSON.stringify({ token: "tok-pub", workspaceId: "public-1", expiresAt: Date.now() + 60_000, personaKey: "public", personaLabel: "Public visitor", role: "public" }));
    const { container } = render(
      <RoleProvider><LiveSessionProvider><TooltipProvider><GatedActionButton label="Sign" onAction={() => {}} /></TooltipProvider></LiveSessionProvider></RoleProvider>,
    );
    const buttons = signButtons(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-disabled")).toBe("true");
    resetLiveSessionForTests();
  });

  it("exposes the disabled reason to assistive tech instead of a hover-only tooltip", () => {
    render(<RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider>);
    const button = screen.getByRole("button", { name: "Promote" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(button)).toBe(DEMO_SESSION_TOOLTIP);
    expect(document.querySelector('span[tabindex="0"]')).toBeNull();
  });

  it("reveals the reason visibly (not only sr-only) when the disabled button is tapped", async () => {
    render(<RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider>);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    const popup = await waitFor(() => {
      const el = document.querySelector('[data-slot="tooltip-content"]');
      if (!el) throw new Error("no popup");
      return el;
    });
    expect(popup.textContent).toContain(DEMO_SESSION_TOOLTIP);
    expect(popup.closest(".sr-only")).toBeNull();
  });
});
