import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPANDED_INTAKE as CHAMPION_PREFILL_PAYLOAD } from "@/tests/fixtures/expanded-intake";

const { intakeChatMock } = vi.hoisted(() => ({ intakeChatMock: vi.fn() }));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  intakeChat: intakeChatMock,
}));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: "requester", personaLabel: "Priya Raman" },
    logout: vi.fn(),
  }),
}));

import { IntakeChat } from "@/components/jeeves/intake-chat";

describe("IntakeChat shared draft", () => {
  beforeEach(() => intakeChatMock.mockReset());

  it("sends the latest structured payload and transfers the assistant update for review", async () => {
    const edited = {
      ...CHAMPION_PREFILL_PAYLOAD,
      basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Edited in structured mode" },
    };
    const assistantUpdate = {
      ...edited,
      basics: { ...edited.basics, businessProblem: "Expanded by chat with sufficient detail." },
    };
    intakeChatMock.mockResolvedValue({
      reply: "Ready to review.",
      updatedPayload: assistantUpdate,
      gaps: [],
      done: true,
    });
    const onPayloadChange = vi.fn();
    const onReview = vi.fn();
    const view = render(<IntakeChat payload={CHAMPION_PREFILL_PAYLOAD} onPayloadChange={onPayloadChange} onReview={onReview} />);
    view.rerender(<IntakeChat payload={edited} onPayloadChange={onPayloadChange} onReview={onReview} />);

    fireEvent.change(screen.getByPlaceholderText("Tell the assistant about your initiative…"), { target: { value: "Please finish it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(intakeChatMock).toHaveBeenCalled());
    expect(intakeChatMock.mock.calls[0][1].partialPayload).toEqual(edited);
    await waitFor(() => expect(onPayloadChange).toHaveBeenCalledWith(assistantUpdate));
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(onReview).toHaveBeenCalledOnce();
  });
});
