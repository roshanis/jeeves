import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("IntakeForm 409 messages", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it("tells a requester whose draft was already submitted to open the case file, not to reload", async () => {
    const { ApiError } = await import("@/lib/client/api");
    mocks.create.mockRejectedValue(new ApiError(409, "intake is no longer editable", undefined, "INTAKE_NOT_EDITABLE"));
    render(<DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("case file");
    expect(alert.textContent).not.toMatch(/reload/i);
  });

  it("treats a submit refused for the intake's state as already submitted, not as a concurrent edit", async () => {
    const { ApiError } = await import("@/lib/client/api");
    mocks.create.mockResolvedValue({ initiativeId: "init-1", slug: "sample", intakeVersionId: "iv-1", version: 1 });
    mocks.submit.mockRejectedValue(new ApiError(409, "Illegal transition: cannot submit from submitted", undefined, "INVALID_STATE"));
    render(<DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already submitted");
    expect(alert.textContent).not.toMatch(/another tab/i);
  });

  it("warns that reloading discards input on a version conflict", async () => {
    const { ApiError } = await import("@/lib/client/api");
    mocks.create.mockRejectedValue(new ApiError(409, "draft changed concurrently (expected version 1)"));
    render(<DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/discards/i);
  });
});
