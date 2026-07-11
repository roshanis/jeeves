// Intake form (/initiatives/new) — champion prefill, live tier preview,
// completeness meter, and the read-only submit gate (ui-spec §4,
// intake-spec §1/§5 worked example).
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

function loadChampion() {
  fireEvent.click(screen.getByRole("button", { name: "Load champion example" }));
}

describe("IntakeForm — empty state", () => {
  it("shows the tier-preview placeholder until all six overlay questions are answered", () => {
    renderForm();
    const preview = document.querySelector('[data-slot="tier-preview"]');
    expect(preview?.textContent).toContain(
      "Answer all six overlay questions to see the tier.",
    );
  });

  it("renders all six overlay questions verbatim (intake-spec §1g)", () => {
    renderForm();
    for (const question of [
      "Does it access PHI?",
      "Do members interact with or receive its output directly?",
      "Does it influence care or coverage decisions?",
      "Is the model vendor-hosted?",
      "Does a qualified human review each output before it takes effect?",
      "Does it affect individuals' opportunities, rights, or services (members, providers, or employees)?",
    ]) {
      expect(screen.getByText(question)).toBeTruthy();
    }
  });
});

describe("IntakeForm — champion prefill (intake-spec §4/§5)", () => {
  it("populates the form fields from CHAMPION_PREFILL_PAYLOAD", () => {
    renderForm();
    loadChampion();

    expect(
      (screen.getByLabelText(/Initiative title/) as HTMLInputElement).value,
    ).toBe("Prior-Auth Clinical Summarizer");
    expect(
      (screen.getByLabelText(/Sponsor organization/) as HTMLInputElement).value,
    ).toBe("Clinical Ops");
    expect(
      (screen.getByLabelText(/Vendor name/) as HTMLInputElement).value,
    ).toBe("Halcyon Clinical AI, Inc.");
  });

  it("tier preview flips to Critical via rule 1 with all 8 domains required", () => {
    renderForm();
    loadChampion();

    const preview = document.querySelector('[data-slot="tier-preview"]');
    expect(preview?.textContent).toContain("Critical");
    expect(preview?.textContent).toContain(
      "Rule 1: care-coverage ∧ ¬human-in-loop → Critical",
    );
    expect(preview?.textContent).toContain("8 required domains");
  });

  it("completeness meter shows the RFT-02 retention gap and the ADV-05 advisory", () => {
    renderForm();
    loadChampion();

    const meter = document.querySelector('[data-slot="completeness-meter"]');
    expect(meter?.textContent).toContain(
      "PHI data retention intent is required for PHI-touching initiatives — please specify how long this data will be retained.",
    );
    expect(meter?.textContent).toContain("No evidence pre-attached");
    // All 11 BLOCKING rules pass -> submission itself is allowed.
    expect(meter?.textContent).toContain("Submission is not blocked");
  });
});

describe("IntakeForm — read-only public mode (no live session)", () => {
  it("renders the submit button disabled with the passcode tooltip", () => {
    renderForm();
    loadChampion();

    const submit = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "Submit intake");
    expect(submit).toBeTruthy();
    expect(submit!.disabled).toBe(true);
  });

  it("disables the form fields and shows the read-only banner", () => {
    renderForm();
    const fieldset = document.querySelector<HTMLFieldSetElement>(
      'fieldset[data-slot="intake-fieldset"]',
    );
    expect(fieldset?.disabled).toBe(true);
    expect(
      screen.getByText(/Enter demo passcode to create a new initiative/),
    ).toBeTruthy();
  });
});
