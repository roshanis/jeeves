import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADDITIONAL_ANSWERS, EXPANDED_INTAKE } from "@/tests/fixtures/expanded-intake";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), submit: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: { token: "test-token", role: "requester", personaLabel: "Priya Raman" }, logout: vi.fn() }),
  useLiveSessionOptional: () => undefined,
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  createInitiative: mocks.create, updateIntakeDraft: mocks.update, submitIntake: mocks.submit,
}));

import { IntakeForm } from "@/components/jeeves/intake-form";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import type { InitiativeDetail } from "@/lib/data/dto";

describe("additional intake questions", () => {
  afterEach(cleanup);
  beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset(); });

  it("collects eight optional answers and sends them in the saved submission", async () => {
    mocks.create.mockResolvedValue({ initiativeId: "new-intake", slug: "new-intake", version: 1 });
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect(screen.getByRole("button", { name: "Submit intake" })).not.toHaveProperty("disabled", true);
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      const field = screen.getByRole("textbox", { name: question });
      expect(field).toHaveProperty("maxLength", 1000);
      expect(field).toHaveProperty("required", false);
      fireEvent.change(field, { target: { value: answer } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][1]).toEqual(EXPANDED_INTAKE);
  });

  it("reopens saved answers and displays nested answers for reviewers", () => {
    const form = render(<IntakeForm initialPayload={EXPANDED_INTAKE} />);
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      expect(screen.getByRole("textbox", { name: question })).toHaveProperty("value", answer);
    }
    form.unmount();
    render(<IntakeTab intake={{ version: 2, submitted: true, missing: [], fields: EXPANDED_INTAKE as unknown as NonNullable<InitiativeDetail["intake"]>["fields"] }} />);
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      expect(screen.getByText(question)).toBeDefined();
      expect(screen.getByText(answer)).toBeDefined();
    }
    expect(screen.getByText("Business problem")).toBeDefined();
    expect(screen.queryByText("basics.businessProblem")).toBeNull();
  });

  it("keeps unanswered optional fields neutral in a legacy draft", () => {
    render(<IntakeTab intake={{ version: 1, submitted: true, missing: [], fields: CHAMPION_PREFILL_PAYLOAD as unknown as NonNullable<InitiativeDetail["intake"]>["fields"] }} />);
    for (const [question] of ADDITIONAL_ANSWERS) expect(screen.getByText(question)).toBeDefined();
    expect(screen.getAllByText("Not provided (optional)")).toHaveLength(8);
  });
});
