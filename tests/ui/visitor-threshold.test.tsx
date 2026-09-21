import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ThresholdEditDialog } from "@/components/jeeves/threshold-edit-dialog";

describe("visitor threshold editor", () => {
  it("edits only a workspace initiative and offers no global-default mutation", () => {
    const confirm = vi.fn();
    renderWithProviders(<ThresholdEditDialog open onOpenChange={vi.fn()} currentThreshold={0.08} initiativeOptions={[{ initiativeId: "visitor-initiative", title: "My demo", slug: "my-demo" }]} pending={false} onConfirm={confirm} />);
    expect(screen.queryByRole("radio", { name: /tier default/i })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Try a stricter check on my example." } });
    fireEvent.click(screen.getByRole("button", { name: "Save threshold" }));
    expect(confirm).toHaveBeenCalledWith({ initiativeId: "visitor-initiative", value: 0.08, reason: "Try a stricter check on my example." });
  });
  it("cannot save an override before a visitor initiative exists", () => {
    renderWithProviders(<ThresholdEditDialog open onOpenChange={vi.fn()} currentThreshold={0.08} initiativeOptions={[]} pending={false} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Try this." } });
    expect(screen.getByRole("button", { name: "Save threshold" })).toHaveProperty("disabled", true);
  });
});
