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
  it("pre-fills and shows each initiative's own current threshold, resetting on change (ui-shell-F3)", () => {
    const confirm = vi.fn();
    renderWithProviders(<ThresholdEditDialog open onOpenChange={vi.fn()} currentThreshold={0.08} initiativeOptions={[
      { initiativeId: "crit", title: "Critical one", slug: "crit-one", currentThreshold: 0.05 },
      { initiativeId: "high", title: "High one", slug: "high-one", currentThreshold: 0.08 },
    ]} pending={false} onConfirm={confirm} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("0.05");
    expect(screen.getByText(/current threshold: 0\.05/i)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "high" } });
    expect(input.value).toBe("0.08");
    expect(screen.getByText(/current threshold: 0\.08/i)).toBeTruthy();
  });
  it("cannot save a value outside 0 to 1", () => {
    renderWithProviders(<ThresholdEditDialog open onOpenChange={vi.fn()} currentThreshold={0.08} initiativeOptions={[{ initiativeId: "i", title: "T", slug: "t", currentThreshold: 0.08 }]} pending={false} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Try this." } });
    for (const bad of ["999", "-0.1"]) {
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: bad } });
      expect(screen.getByRole("button", { name: "Save threshold" })).toHaveProperty("disabled", true);
    }
  });
});
