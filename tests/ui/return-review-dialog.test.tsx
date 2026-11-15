import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReturnReviewDialog } from "@/components/jeeves/return-review-dialog";

afterEach(cleanup);
function setup(extra: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const onReasonChange = vi.fn();
  render(<ReturnReviewDialog open onOpenChange={onOpenChange} domainLabel="Security" pending={false} onConfirm={vi.fn()} onReasonChange={onReasonChange} {...extra} />);
  return { onOpenChange, onReasonChange };
}

describe("ReturnReviewDialog", () => {
  it("disables Cancel and ignores Escape while the return is pending", () => {
    const { onOpenChange } = setup({ pending: true });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
  it("still closes on Cancel when nothing is pending", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("shows a server error inline as an alert", () => {
    setup({ error: "Too many requests. Try again shortly." });
    expect(screen.getByRole("alert").textContent).toContain("Too many requests");
  });
  it("reports the typed reason on change so Cancel does not lose it", () => {
    const { onReasonChange } = setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Missing DPIA" } });
    expect(onReasonChange).toHaveBeenCalledWith("Missing DPIA");
  });
});
