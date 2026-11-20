import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), submit: vi.fn(), push: vi.fn(), replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: "requester", personaLabel: "Priya Raman", workspaceId: "ws-1" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  createInitiative: mocks.create,
  updateIntakeDraft: mocks.update,
  submitIntake: mocks.submit,
}));

import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import { IntakeForm } from "@/components/jeeves/intake-form";

const created = { initiativeId: "init-1", slug: "draft-one", intakeVersionId: "iv-1", version: 1 };
const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function renderWithLinks() {
  return render(
    <>
      <a href="/inbox">inbox</a>
      <a href="/inbox" target="_blank">blank</a>
      <a href="#main">hash</a>
      <a href="https://example.org/">other</a>
      <DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>
    </>,
  );
}

describe("IntakeForm leave warning", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("warns on unload only while there are unsaved edits", async () => {
    mocks.create.mockResolvedValue(created);
    render(<IntakeForm />);
    expect(unload()).toBe(false);
    type("Initiative title", "Something");
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    await waitFor(() => expect(unload()).toBe(false));
  });

  it("does not warn for an untouched sample", () => {
    // The sample button exists only in demo mode.
    render(<DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect(unload()).toBe(false);
  });

  it("is off after a successful submit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.create.mockResolvedValue(created);
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    renderWithLinks();
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    type("Initiative title", "Sample, edited");
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/initiatives/draft-one"));
    expect(unload()).toBe(false);
    fireEvent.click(screen.getByRole("link", { name: "inbox" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before a plain link click and cancels the navigation on Cancel", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithLinks();
    type("Initiative title", "Something");
    expect(fireEvent.click(screen.getByRole("link", { name: "inbox" }))).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(String(confirm.mock.calls[0][0])).toMatch(/unsaved changes/i);
    confirm.mockReturnValue(true);
    const link = screen.getByRole("link", { name: "inbox" });
    let prevented: boolean | null = null;
    link.addEventListener("click", (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
    fireEvent.click(link);
    expect(prevented).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves new-tab, modified, hash and cross-origin links alone", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithLinks();
    type("Initiative title", "Something");
    fireEvent.click(screen.getByRole("link", { name: "blank" }));
    fireEvent.click(screen.getByRole("link", { name: "inbox" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "hash" }));
    fireEvent.click(screen.getByRole("link", { name: "other" }));
    expect(confirm).not.toHaveBeenCalled();
  });
});
