import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: "requester", personaLabel: "Priya Raman" },
    logout: vi.fn(),
  }),
}));

import { IntakeForm } from "@/components/jeeves/intake-form";

describe("IntakeForm accessibility semantics", () => {
  afterEach(cleanup);

  it("names the PHI checkbox set as a group", () => {
    render(<IntakeForm />);
    expect(screen.getByRole("group", { name: /PHI categories touched/ })).toBeTruthy();
  });

  it("announces the completeness summary in a polite live region", () => {
    const { container } = render(<IntakeForm />);
    const live = container.querySelector('[data-slot="completeness-meter"] [aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it("marks blocking fields required and keeps hints out of the accessible name", () => {
    render(<IntakeForm />);
    const problem = screen.getByRole("textbox", { name: "Business problem" });
    expect((problem as HTMLTextAreaElement).required).toBe(true);
    expect(problem.getAttribute("aria-required")).toBeNull();
    const hintId = problem.getAttribute("aria-describedby");
    expect(document.getElementById(hintId!.split(" ")[0])?.textContent).toMatch(/Describe the problem/);
  });

  it("ties a blocking gap to its field once the form is touched", () => {
    render(<IntakeForm />);
    const title = screen.getByRole("textbox", { name: "Initiative title" });
    expect(title.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(title, { target: { value: "x" } });
    fireEvent.change(title, { target: { value: "" } });
    expect(title.getAttribute("aria-invalid")).toBe("true");
    const ids = title.getAttribute("aria-describedby")!.split(" ");
    expect(ids.some((id) => document.getElementById(id)?.getAttribute("data-slot") === "completeness-gap")).toBe(true);
  });

  it("marks the data sources field required and ties it to its gap row", () => {
    render(<IntakeForm />);
    const sources = screen.getByRole("textbox", { name: /Data source/ }) as HTMLTextAreaElement;
    expect(sources.required).toBe(true);
    expect(sources.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Initiative title" }), { target: { value: "x" } });
    expect(sources.getAttribute("aria-invalid")).toBe("true");
    expect(sources.getAttribute("aria-describedby")!.split(" ")).toContain("intake-gap-BLK-11");
  });

  it("marks each overlay Yes/No group required and points it at its open gap row", () => {
    render(<IntakeForm />);
    const group = screen.getByRole("group", { name: /does it access PHI/i });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.required)).toBe(true);
    expect(group.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Initiative title" }), { target: { value: "x" } });
    expect(group.getAttribute("aria-describedby")!.split(" ")).toContain("intake-gap-BLK-05");
    fireEvent.click(radios[0]);
    expect(group.getAttribute("aria-describedby")).toBeNull();
  });
});
