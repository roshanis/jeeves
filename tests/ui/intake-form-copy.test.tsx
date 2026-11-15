import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), submit: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: "requester", personaLabel: "Priya Raman" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  createInitiative: mocks.create,
  updateIntakeDraft: mocks.update,
  submitIntake: mocks.submit,
}));

import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import { IntakeForm } from "@/components/jeeves/intake-form";

describe("IntakeForm submit hint", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it("points at the Completeness panel, not at gaps 'above' the button", () => {
    render(<IntakeForm />);
    const hint = screen.getByText(/blocking gaps/i);
    expect(hint.textContent).not.toMatch(/above/i);
    expect(hint.textContent).toContain("Completeness");
  });
});

describe("IntakeForm sample initiative button", () => {
  afterEach(cleanup);

  it("is offered in demo mode and hidden in production", () => {
    const demo = render(
      <DeploymentModeProvider mode="demo">
        <IntakeForm />
      </DeploymentModeProvider>,
    );
    expect(screen.queryByRole("button", { name: /sample initiative/i })).not.toBeNull();
    demo.unmount();
    render(
      <DeploymentModeProvider mode="production">
        <IntakeForm />
      </DeploymentModeProvider>,
    );
    expect(screen.queryByRole("button", { name: /sample initiative/i })).toBeNull();
  });
});
