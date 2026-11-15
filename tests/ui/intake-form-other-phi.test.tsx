import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { IntakeForm } from "@/components/jeeves/intake-form";

const created = { initiativeId: "init-1", slug: "draft-one", intakeVersionId: "iv-1", version: 1 };

describe("IntakeForm other PHI category", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it("drops the 'Other PHI category' text when Other is unticked", async () => {
    mocks.create.mockResolvedValue(created);
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("Other PHI category"), { target: { value: "Genomic data" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][1].data.phiCategoriesOtherText).toBeNull();
  });
});
