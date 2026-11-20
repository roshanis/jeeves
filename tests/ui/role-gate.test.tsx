import { describe, expect, it, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEMO_SESSION_TOOLTIP,
  GatedActionButton,
} from "@/components/jeeves/role-gate";
import { RoleProvider, useRole } from "@/components/jeeves/role-context";
import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
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

  it("explains a signed-in reviewer's disabled action with the supplied reason, not the demo prompt", () => {
    resetLiveSessionForTests();
    sessionStorage.setItem("jeeves_live_session", JSON.stringify({ token: "tok-rev", workspaceId: "w-1", expiresAt: Date.now() + 60_000, personaKey: "marcus-webb", personaLabel: "Marcus Webb", role: "reviewer" }));
    render(
      <RoleProvider><LiveSessionProvider><TooltipProvider><GatedActionButton label="Sign" requiresRole="reviewer" disabledReason="Only the Legal reviewer can sign this review" /></TooltipProvider></LiveSessionProvider></RoleProvider>,
    );
    const button = screen.getByRole("button", { name: "Sign" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(button)).toBe("Only the Legal reviewer can sign this review");
    resetLiveSessionForTests();
  });

  it("exposes the disabled reason to assistive tech instead of a hover-only tooltip", () => {
    render(<DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider></DeploymentModeProvider>);
    const button = screen.getByRole("button", { name: "Promote" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(button)).toBe(DEMO_SESSION_TOOLTIP);
    expect(document.querySelector('span[tabindex="0"]')).toBeNull();
  });

  it("reveals the reason visibly (not only sr-only) when the disabled button is tapped", async () => {
    render(<DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider></DeploymentModeProvider>);
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

  // In Chromium a mouse click or a tap focuses the action without :focus-visible, so focus does
  // not open the reason there. The tooltip library treats every focus in jsdom as visible, and the
  // press focuses the action, so the test above passes on focus alone. This one takes focus away.
  it("opens the reason on a press when focus does not show it", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    try {
      render(<DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider></DeploymentModeProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Promote" }));
      await waitFor(() => expect(popupOpen()).toBe(true));
    } finally {
      focus.mockRestore();
    }
  });

  async function openByTap() {
    render(<DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider></DeploymentModeProvider>);
    const button = screen.getByRole("button", { name: "Promote" });
    fireEvent.click(button);
    await waitFor(() => { if (!document.querySelector('[data-slot="tooltip-content"]')) throw new Error("no popup"); });
    return button;
  }
  const popupOpen = () => {
    const el = document.querySelector('[data-slot="tooltip-content"]');
    return Boolean(el) && !el!.hasAttribute("data-closed") && el!.getAttribute("data-open") !== null;
  };
  const hover = (el: HTMLElement) => { fireEvent.mouseEnter(el); fireEvent.mouseMove(el); };
  const leave = (el: HTMLElement) => { fireEvent.mouseOut(el); fireEvent(el, new MouseEvent("mouseleave")); };

  // jsdom does not reproduce the tooltip closing on a press of its trigger: that half of the
  // behaviour is tested in a real browser (tests/e2e/disabled-actions.spec.ts). This guards against a toggle.
  it("does not toggle the reason off when the disabled button is pressed again", async () => {
    const button = await openByTap();
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(popupOpen()).toBe(true);
  });

  it("keeps the reason when the mouse leaves after a tap", async () => {
    const button = await openByTap();
    leave(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(popupOpen()).toBe(true);
  });

  it("hides a hovered reason when the mouse leaves", async () => {
    render(<DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><GatedActionButton label="Promote" /></TooltipProvider></RoleProvider></DeploymentModeProvider>);
    const button = screen.getByRole("button", { name: "Promote" });
    hover(button);
    await waitFor(() => expect(popupOpen()).toBe(true));
    leave(button);
    await waitFor(() => expect(popupOpen()).toBe(false));
  });

  it("hides a hovered reason when the mouse leaves once a tapped reason was dismissed", async () => {
    const button = await openByTap();
    fireEvent.keyDown(button, { key: "Escape" });
    await waitFor(() => expect(popupOpen()).toBe(false));
    hover(button);
    await waitFor(() => expect(popupOpen()).toBe(true));
    leave(button);
    await waitFor(() => expect(popupOpen()).toBe(false));
  });

  it("closes a tapped reason on Escape", async () => {
    const button = await openByTap();
    fireEvent.keyDown(button, { key: "Escape" });
    await waitFor(() => expect(popupOpen()).toBe(false));
  });

  it("closes a tapped reason on a press elsewhere", async () => {
    await openByTap();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(popupOpen()).toBe(false));
  });

  it("focuses the pressed action, so that focus moving on dismisses the reason", async () => {
    render(
      <RoleProvider><TooltipProvider>
        <GatedActionButton label="Promote" />
        <button type="button">next</button>
      </TooltipProvider></RoleProvider>,
    );
    const button = screen.getByRole("button", { name: "Promote" });
    // fireEvent.click sends a click and nothing else, so nothing focuses the button, as with a click in Safari.
    fireEvent.click(button);
    await waitFor(() => expect(popupOpen()).toBe(true));
    expect(document.activeElement).toBe(button);
    act(() => screen.getByRole("button", { name: "next" }).focus());
    await waitFor(() => expect(popupOpen()).toBe(false));
  });

  it("closes a tapped reason when the reason of another action opens", async () => {
    render(
      <RoleProvider><TooltipProvider>
        <GatedActionButton label="Promote" />
        <GatedActionButton label="Pause" />
      </TooltipProvider></RoleProvider>,
    );
    const openReasons = () =>
      [...document.querySelectorAll('[data-slot="tooltip-content"]')].filter((el) => el.hasAttribute("data-open"));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(openReasons()).toHaveLength(1));
    const first = openReasons()[0];
    // No pointerdown first: this is the tooltip group handing over, not a press elsewhere.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      const now = openReasons();
      expect(now).toHaveLength(1);
      expect(now[0]).not.toBe(first);
    });
  });
});
