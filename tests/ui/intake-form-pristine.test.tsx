// The completeness panel used to greet a first-time visitor with 11 BLOCKING
// errors and 5 advisories in red, at "Evaluated rules passing 0%", before
// they had typed a character — and in the default read-only mode the form is
// non-interactive, so those were failures for fields the visitor is not
// permitted to fill. /initiatives/new is a public route reachable straight
// from the marketing site, so this is a first impression that reads as
// broken rather than as a guided form.
//
// The information is unchanged; only its framing before first interaction is.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider } from "@/lib/client/session-context";
import { IntakeForm } from "@/components/jeeves/intake-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

function renderForm() {
  return renderWithProviders(
    <LiveSessionProvider>
      <IntakeForm />
    </LiveSessionProvider>,
  );
}

function meter(): HTMLElement {
  const el = document.querySelector('[data-slot="completeness-meter"]');
  if (!el) throw new Error("completeness meter not found");
  return el as HTMLElement;
}

describe("IntakeForm — completeness panel before first interaction", () => {
  it("frames outstanding items as remaining work, not as failures", () => {
    renderForm();

    expect(meter().dataset.pristine).toBe("true");
    expect(screen.queryByText(/blocking gaps must be resolved/i)).toBeNull();
    // Both the status line and the group heading use this framing.
    expect(screen.getByText(/^Still to complete before this can be submitted:$/)).toBeDefined();
    expect(screen.getByText(/^Still to complete \(\d+\)$/)).toBeDefined();
  });

  it("still lists every gap — the information is unchanged", () => {
    renderForm();

    const gaps = meter().querySelectorAll('[data-slot="completeness-gap"]');
    expect(gaps.length).toBeGreaterThan(0);
    // The blocking rules are still present and still marked as blocking for
    // anything reading the DOM (tests, assistive tech, the submit gate).
    expect(meter().querySelectorAll('[data-level="BLOCKING"]').length).toBeGreaterThan(0);
  });

  it("switches to the error framing once the user starts filling it in", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Initiative title"), {
      target: { value: "Prior-Auth Summarizer" },
    });

    expect(meter().dataset.pristine).toBe("false");
    expect(screen.getByText(/blocking gaps must be resolved/i)).toBeDefined();
  });

  it("switches to the error framing when the champion example is loaded", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Load champion example" }));

    expect(meter().dataset.pristine).toBe("false");
  });
});
