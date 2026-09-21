import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), submit: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
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
  createIntakeRequestId: () => "unique-intake-request-key",
}));

import { IntakeForm } from "@/components/jeeves/intake-form";

const created = { initiativeId: "init-1", slug: "draft-one", intakeVersionId: "iv-1", version: 1 };

describe("IntakeForm retry recovery", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("replays the original create after a lost response, then CAS-saves intervening edits", async () => {
    mocks.create.mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(created);
    mocks.update.mockImplementation(async (_token, _id, payload) => ({ ...created, intakeVersionId: "iv-2", version: 2, payload }));
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit intake" })).not.toHaveProperty("disabled", true));
    const originalPayload = mocks.create.mock.calls[0][1];
    const originalKey = mocks.create.mock.calls[0][2];

    fireEvent.change(screen.getByLabelText("Initiative title"), { target: { value: "Edited while recovering" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());

    expect(mocks.create.mock.calls[1][1]).toEqual(originalPayload);
    expect(mocks.create.mock.calls[1][2]).toBe(originalKey);
    expect(mocks.update).toHaveBeenCalledWith(
      "token", "init-1", expect.objectContaining({ basics: expect.objectContaining({ title: "Edited while recovering" }) }), 1,
    );
  });

  it("retries submit directly after its response is lost without creating or updating again", async () => {
    mocks.create.mockResolvedValue(created);
    mocks.submit.mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce({ submitted: true, completenessPct: 95 });
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit intake" })).not.toHaveProperty("disabled", true));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/initiatives/draft-one");
  });
});
