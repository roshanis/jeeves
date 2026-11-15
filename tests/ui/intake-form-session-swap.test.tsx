import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), submit: vi.fn(), push: vi.fn(), keys: 0,
  session: { token: "token-a", workspaceId: "public-ws-a", role: "public", personaLabel: "Public visitor" },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: mocks.session, logout: vi.fn() }),
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  createInitiative: mocks.create,
  updateIntakeDraft: mocks.update,
  submitIntake: mocks.submit,
  createIntakeRequestId: () => `unique-intake-request-key-${++mocks.keys}`,
}));

import { IntakeForm } from "@/components/jeeves/intake-form";

describe("IntakeForm after the session's workspace changes", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.keys = 0;
    mocks.session = { token: "token-a", workspaceId: "public-ws-a", role: "public", personaLabel: "Public visitor" };
    for (const mock of [mocks.create, mocks.update, mocks.submit, mocks.push]) mock.mockReset();
  });

  it("creates a fresh draft in the new workspace instead of updating the old initiative", async () => {
    mocks.create.mockResolvedValue({ initiativeId: "init-1", slug: "draft-one", intakeVersionId: "iv-1", version: 1 });
    mocks.submit.mockResolvedValue({ submitted: false, gaps: [] });
    const { rerender } = render(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit intake" })).not.toHaveProperty("disabled", true));

    mocks.session = { token: "token-b", workspaceId: "public-ws-b", role: "public", personaLabel: "Public visitor" };
    rerender(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[1][0]).toBe("token-b");
    expect(mocks.create.mock.calls[1][2]).not.toBe(mocks.create.mock.calls[0][2]);
  });
});
