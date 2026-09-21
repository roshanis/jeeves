import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPANDED_INTAKE as CHAMPION_PREFILL_PAYLOAD } from "@/tests/fixtures/expanded-intake";

const { intakeChatMock } = vi.hoisted(() => ({ intakeChatMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
import { IntakeModeToggle } from "@/components/jeeves/intake-mode-toggle";

describe("IntakeChat shared draft", () => {
  beforeEach(() => intakeChatMock.mockReset());
  afterEach(cleanup);

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
    await waitFor(() => expect(onPayloadChange).toHaveBeenCalledWith(assistantUpdate, 0));
    view.rerender(<IntakeChat payload={assistantUpdate} onPayloadChange={onPayloadChange} onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("preserves manual edits made while a chat response is pending across mode switches", async () => {
    let resolveChat!: (value: unknown) => void;
    intakeChatMock.mockReturnValue(new Promise((resolve) => { resolveChat = resolve; }));
    render(<IntakeModeToggle initialPayload={CHAMPION_PREFILL_PAYLOAD} />);
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Tell the assistant about your initiative…"), { target: { value: "Please finish it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("tab", { name: "Structured form" }));
    fireEvent.change(screen.getByLabelText("Initiative title"), { target: { value: "New manual title" } });

    await act(async () => resolveChat({
      reply: "Stale assistant answer",
      updatedPayload: CHAMPION_PREFILL_PAYLOAD,
      gaps: [],
      done: true,
    }));

    expect(screen.getByLabelText("Initiative title")).toHaveProperty("value", "New manual title");
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    expect(screen.queryByText("Stale assistant answer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review and submit" })).toBeNull();
    expect(screen.getByText("Please finish it")).toBeDefined();

    const latest = { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "New manual title" } };
    intakeChatMock.mockResolvedValue({ reply: "Latest answers reviewed", updatedPayload: latest, gaps: [], done: true });
    fireEvent.change(screen.getByPlaceholderText("Tell the assistant about your initiative…"), { target: { value: "Continue with my edits" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Latest answers reviewed")).toBeDefined());
    expect(intakeChatMock.mock.calls[1][1].partialPayload).toEqual(latest);
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(screen.getByLabelText("Initiative title")).toHaveProperty("value", "New manual title");
  });

  it("accepts a pending response after mode switching when the answers have not changed", async () => {
    let resolveChat!: (value: unknown) => void;
    intakeChatMock.mockReturnValue(new Promise((resolve) => { resolveChat = resolve; }));
    render(<IntakeModeToggle initialPayload={CHAMPION_PREFILL_PAYLOAD} />);
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Tell the assistant about your initiative…"), { target: { value: "Please finish it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("tab", { name: "Structured form" }));
    const updatedPayload = { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Assistant title" } };
    await act(async () => resolveChat({ reply: "Ready to review", updatedPayload, gaps: [], done: true }));
    expect(screen.getByLabelText("Initiative title")).toHaveProperty("value", "Assistant title");
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    expect(screen.getByRole("button", { name: "Review and submit" })).toBeDefined();
  });

  it("clears completion and gap results after the structured payload changes", async () => {
    intakeChatMock.mockResolvedValue({
      reply: "Ready to review.",
      updatedPayload: CHAMPION_PREFILL_PAYLOAD,
      gaps: [{ ruleId: "ADV-01", field: "deployment.rolloutPlan", level: "ADVISORY", message: "Earlier gap" }],
      done: true,
    });
    render(<IntakeModeToggle initialPayload={CHAMPION_PREFILL_PAYLOAD} />);
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Tell the assistant about your initiative…"), { target: { value: "Please finish it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review and submit" })).toBeDefined());
    expect(screen.getByText(/Earlier gap/)).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Structured form" }));
    fireEvent.change(screen.getByLabelText("Initiative title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    expect(screen.queryByRole("button", { name: "Review and submit" })).toBeNull();
    expect(screen.queryByText(/Earlier gap/)).toBeNull();
  });
});
