import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: { token: "t", role: "requester", personaLabel: "P" }, logout: vi.fn() }),
}));

import { IntakeForm } from "@/components/jeeves/intake-form";

function type(el: HTMLTextAreaElement, text: string) {
  for (const ch of text) fireEvent.change(el, { target: { value: el.value + ch } });
}

describe("IntakeForm one-per-line textareas", () => {
  afterEach(cleanup);

  it("keeps spaces and line breaks while the user types, per keystroke", () => {
    render(<IntakeForm />);
    const field = screen.getByLabelText(/Data source\(s\)/) as HTMLTextAreaElement;
    type(field, "Clinical notes (Epic)\nLab results");
    expect(field.value).toBe("Clinical notes (Epic)\nLab results");
  });

  it("derives the payload array from the typed lines", () => {
    const onPayloadChange = vi.fn();
    const { rerender } = render(<IntakeForm onPayloadChange={onPayloadChange} />);
    const field = screen.getByLabelText(/Affected populations/) as HTMLTextAreaElement;
    type(field, "Prior auth nurses\nMembers");
    expect(field.value).toBe("Prior auth nurses\nMembers");
    const last = onPayloadChange.mock.calls.at(-1)?.[0];
    expect(last.populationImpact.affectedPopulations).toEqual(["Prior auth nurses", "Members"]);
    rerender(<IntakeForm onPayloadChange={onPayloadChange} />);
    expect(field.value).toBe("Prior auth nurses\nMembers");
  });

  it("resyncs when a sample initiative replaces the payload", () => {
    render(<IntakeForm />);
    const field = screen.getByLabelText(/Data source\(s\)/) as HTMLTextAreaElement;
    type(field, "abc");
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect(field.value).not.toBe("abc");
    expect(field.value.length).toBeGreaterThan(3);
  });
});
