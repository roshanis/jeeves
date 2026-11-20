import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { intakeChatMock, sessionRef } = vi.hoisted(() => ({
  intakeChatMock: vi.fn(),
  sessionRef: { role: "requester" as string },
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  intakeChat: intakeChatMock,
}));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: sessionRef.role, personaLabel: "Priya Raman" },
    logout: vi.fn(),
  }),
}));

import { IntakeChat } from "@/components/jeeves/intake-chat";

const PLACEHOLDER = "Tell the assistant about your initiative…";

describe("IntakeChat", () => {
  beforeEach(() => { intakeChatMock.mockReset(); sessionRef.role = "requester"; });
  afterEach(cleanup);

  it("tells a public (real request) visitor to use the structured form, not to switch persona", () => {
    sessionRef.role = "public";
    render(<IntakeChat />);
    expect(document.body.textContent).not.toMatch(/switch to a requester persona|viewing as/i);
    expect(document.body.textContent).toMatch(/structured form/i);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it("sends a bounded window of recent turns so long interviews stay under the server cap", async () => {
    intakeChatMock.mockResolvedValue({ reply: "ok", updatedPayload: {}, gaps: [], done: false });
    render(<IntakeChat />);
    const input = () => screen.getByPlaceholderText(PLACEHOLDER);
    for (let i = 0; i < 30; i++) {
      fireEvent.change(input(), { target: { value: `message ${i}` } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(intakeChatMock).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true));
    }
    for (const call of intakeChatMock.mock.calls) expect(call[1].conversation.length).toBeLessThanOrEqual(40);
    const last = intakeChatMock.mock.calls.at(-1)![1].conversation;
    expect(last.at(-1)).toEqual({ role: "user", content: "message 29" });
  });

  it("restores the typed message and drops the optimistic turn when a send fails", async () => {
    intakeChatMock.mockRejectedValue(new Error("boom"));
    render(<IntakeChat />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "my answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect((screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value).toBe("my answer"));
    expect(document.querySelector('[data-slot="intake-chat-transcript"]')!.textContent).not.toContain("my answer");
  });

  it("announces replies, labels the input, ignores Enter while composing and shows a fallback for an empty reply", async () => {
    intakeChatMock.mockResolvedValue({ reply: "", updatedPayload: {}, gaps: [], done: false });
    render(<IntakeChat />);
    const log = document.querySelector('[data-slot="intake-chat-transcript"]')!;
    expect(log.getAttribute("role")).toBe("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    const input = screen.getByRole("textbox", { name: /message to the intake assistant/i });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(intakeChatMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(intakeChatMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(log.textContent).toContain("No further questions"));
  });

  it("does not promise an interview in the empty state", () => {
    render(<IntakeChat />);
    expect(document.querySelector('[data-slot="intake-chat-transcript"]')!.textContent).not.toMatch(/until the intake is complete/i);
  });

  async function sendOne(adapter: "mock" | "openai") {
    intakeChatMock.mockResolvedValue({ reply: "Does it access PHI?", updatedPayload: {}, gaps: [], done: false, adapter });
    render(<IntakeChat />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(document.querySelector('[data-slot="intake-chat-transcript"]')!.textContent).toContain("Does it access PHI?"));
  }

  it("labels the assistant as scripted when the mock adapter answered", async () => {
    await sendOne("mock");
    expect(screen.getByText(/scripted demo assistant/i)).toBeDefined();
    expect(document.body.textContent).toMatch(/answers are canned, not interpreted/i);
  });

  it("shows no scripted label when a model answered", async () => {
    await sendOne("openai");
    expect(screen.queryByText(/scripted demo assistant/i)).toBeNull();
  });
});
