// Getting from "I want to submit an intake" to actually submitting one.
//
// The flow works — verified end to end against a live server: unlock live
// mode, fill the form, POST /api/initiatives 200, POST .../submit 200. The
// problem was finding it. A visitor landing on /initiatives/new saw a
// disabled form and a notice ending "(use the chip in the header)", which is
// an instruction to go hunting for a control somewhere else on the page.
//
// The passcode gate itself is a hard rule and stays exactly as it was: public
// visitors are read-only and every mutation needs the passcode. This only
// puts the way in where the need is.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider } from "@/lib/client/session-context";
import { IntakeForm } from "@/components/jeeves/intake-form";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/initiatives/new",
}));

function renderReadOnly() {
  return renderWithProviders(
    <LiveSessionProvider>
      {/* The chip hosts the passcode dialog; both live under one provider in
          the real app (console layout + page). */}
      <DemoModeChip />
      <IntakeForm />
    </LiveSessionProvider>,
  );
}

describe("IntakeForm — read-only notice offers the way in", () => {
  it("renders a control that unlocks live mode, not just a pointer to one", () => {
    renderReadOnly();

    const unlock = screen.getByRole("button", { name: /enter the demo passcode/i });
    expect(unlock).toBeDefined();
  });

  it("no longer tells the reader to go find the header chip", () => {
    renderReadOnly();
    expect(screen.queryByText(/use the chip in the header/i)).toBeNull();
  });

  it("opens the passcode dialog when that control is used", () => {
    renderReadOnly();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /enter the demo passcode/i }));

    expect(screen.getByRole("dialog")).toBeDefined();
    // Same dialog the header chip opens — one implementation, not a copy.
    expect(screen.getByText(/enter live demo mode/i)).toBeDefined();
  });

  it("still gates submission behind the passcode", () => {
    renderReadOnly();

    const submit = screen.getAllByRole("button", { name: /submit intake/i })[0]!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
