import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), submit: vi.fn(), push: vi.fn(), replace: vi.fn(),
  session: { token: "token", role: "requester", personaLabel: "Priya Raman", workspaceId: "ws-1" } as
    | { token: string; role: string; personaLabel: string; workspaceId: string }
    | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: mocks.session, logout: vi.fn() }),
  useLiveSessionOptional: () => ({ session: mocks.session, logout: vi.fn() }),
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  createInitiative: mocks.create,
  updateIntakeDraft: mocks.update,
  submitIntake: mocks.submit,
}));

import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import { IntakeForm, PUBLIC_DRAFT_KEY } from "@/components/jeeves/intake-form";
import { EMPTY_INTAKE_PAYLOAD } from "@/lib/intake/defaults";
import { SAMPLE_INITIATIVE_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { IntakePayload } from "@/lib/intake/types";

const created = { initiativeId: "init-1", slug: "draft-one", intakeVersionId: "iv-1", version: 1 };

function Harness({ initial = SAMPLE_INITIATIVE_PAYLOAD }: { initial?: IntakePayload }) {
  const [payload, setPayload] = React.useState(initial);
  return (
    <IntakeForm
      initialPayload={payload}
      onPayloadChange={setPayload}
      initiativeId="init-1"
      initialVersion={3}
      initialSlug="draft-one"
    />
  );
}

function NewHarness({ initial }: { initial: IntakePayload }) {
  const [p, setP] = React.useState(initial);
  return <IntakeForm initialPayload={p} onPayloadChange={setP} />;
}

const withTitle = (title: string): IntakePayload => ({
  ...EMPTY_INTAKE_PAYLOAD,
  basics: { ...EMPTY_INTAKE_PAYLOAD.basics, title },
});
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const saveButton = () => screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement;
const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("IntakeForm Save draft", () => {
  beforeEach(() => {
    mocks.session = { token: "token", role: "requester", personaLabel: "Priya Raman", workspaceId: "ws-1" };
    for (const mock of [mocks.create, mocks.update, mocks.submit, mocks.push, mocks.replace]) mock.mockReset();
    window.sessionStorage.removeItem(PUBLIC_DRAFT_KEY);
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.removeItem(PUBLIC_DRAFT_KEY);
  });

  it("saves a title-only draft on /new through createInitiative and moves to the edit page", async () => {
    mocks.create.mockResolvedValue(created);
    render(<IntakeForm />);
    type("Initiative title", "Half-finished idea");
    expect((screen.getByRole("button", { name: "Submit intake" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const [token, payload, requestId] = mocks.create.mock.calls[0];
    expect(token).toBe("token");
    expect(payload.basics.title).toBe("Half-finished idea");
    expect(String(requestId).length).toBeGreaterThanOrEqual(16);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/initiatives/draft-one/edit"));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("offers Save only to authors with something to save and a title", () => {
    const { unmount } = render(<IntakeForm />);
    expect(saveButton().disabled).toBe(true);
    type("Sponsor organization", "Claims Ops");
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText("Add an initiative title to save a draft.")).toBeDefined();
    type("Initiative title", "Titled");
    expect(saveButton().disabled).toBe(false);
    unmount();

    mocks.session = { token: "token", role: "reviewer", personaLabel: "Rev", workspaceId: "ws-1" };
    render(<IntakeForm />);
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    cleanup();
    mocks.session = null;
    render(<IntakeForm />);
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("saves edits on the edit page as a new draft version and keeps the version chain", async () => {
    mocks.update.mockResolvedValue({ ...created, version: 4 });
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<Harness />);
    expect(saveButton().disabled).toBe(true);
    type("Initiative title", "Edited title");
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("token", "init-1", expect.anything(), 3));
    expect(mocks.update.mock.calls[0][2].basics.title).toBe("Edited title");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Draft saved"));
    expect(saveButton().disabled).toBe(true);
    type("Initiative title", "Edited again");
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenLastCalledWith("token", "init-1", expect.anything(), 4);
  });

  it("submits after an unchanged save without a second update", async () => {
    mocks.update.mockResolvedValue({ ...created, version: 4 });
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<Harness />);
    type("Initiative title", "Edited title");
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("shows a failed save, keeps the typed title and keeps the leave warning armed", async () => {
    const { ApiError } = await import("@/lib/client/api");
    mocks.update.mockRejectedValue(new ApiError(409, "draft changed concurrently (expected version 3)"));
    render(<Harness />);
    type("Initiative title", "Kept title");
    fireEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/changed in another tab/i);
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("Kept title");
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(unload()).toBe(true);
  });

  it("does not send two updates for two quick clicks on Save", async () => {
    let resolve!: (value: unknown) => void;
    mocks.update.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Harness />);
    type("Initiative title", "Edited title");
    const button = saveButton();
    act(() => { button.click(); button.click(); });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ...created, version: 4 }); });
  });

  it("does not navigate after unmount when a slow first save resolves late", async () => {
    let resolve!: (value: unknown) => void;
    mocks.create.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<IntakeForm />);
    type("Initiative title", "Slow save");
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { resolve(created); });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps a public draft in this tab only and still warns on unload", () => {
    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    render(<IntakeForm />);
    type("Initiative title", "My real request");
    type("Requester email", "me@example.org");
    fireEvent.click(saveButton());
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    const stored = JSON.parse(window.sessionStorage.getItem(PUBLIC_DRAFT_KEY) ?? "null");
    expect(stored.payload.basics.title).toBe("My real request");
    expect(typeof stored.savedAt).toBe("number");
    expect(screen.getByRole("status").textContent).toContain("Not sent yet");
    expect(unload()).toBe(true);
  });

  it("keeps the unload prompt armed for a saved tab copy after the public session expires", () => {
    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    const view = render(<IntakeForm />);
    type("Initiative title", "My real request");
    fireEvent.click(saveButton());
    expect(window.sessionStorage.getItem(PUBLIC_DRAFT_KEY)).not.toBeNull();
    mocks.session = null;
    view.rerender(<IntakeForm />);
    expect(unload()).toBe(true);
    window.sessionStorage.removeItem(PUBLIC_DRAFT_KEY);
    view.rerender(<IntakeForm />);
    expect(unload()).toBe(false);
  });

  it("does not arm the unload prompt for a persona's saved draft even when the tab holds a real-request copy", () => {
    window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ payload: withTitle("Saved in tab"), savedAt: 1 }));
    render(<Harness initial={withTitle("Persona draft")} />);
    expect(unload()).toBe(false);
  });

  it("does not arm the unload prompt for a tab copy when the form is empty", () => {
    window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ payload: withTitle("Saved in tab"), savedAt: 1 }));
    mocks.session = null;
    render(<IntakeForm />);
    expect(unload()).toBe(false);
  });

  it("keeps one status live region mounted and only changes its text", async () => {
    mocks.update.mockResolvedValue({ ...created, version: 4 });
    render(<Harness />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    type("Initiative title", "Edited title");
    fireEvent.click(saveButton());
    await waitFor(() => expect(region.textContent).toContain("Draft saved"));
    expect(screen.getByRole("status")).toBe(region);
    type("Initiative title", "Edited again");
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("");
  });

  it("points Save draft at the blank-title hint only while the hint is shown", () => {
    render(<IntakeForm />);
    expect(saveButton().getAttribute("aria-describedby")).toBeNull();
    type("Sponsor organization", "Claims Ops");
    const hint = screen.getByText("Add an initiative title to save a draft.");
    expect(hint.id).not.toBe("");
    expect(saveButton().getAttribute("aria-describedby")).toBe(hint.id);
    type("Initiative title", "Titled");
    expect(saveButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("restores a saved public draft into a public session only, and ignores bad data", () => {
    window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ payload: withTitle("Saved in tab"), savedAt: 1 }));
    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    const first = render(<IntakeForm />);
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("Saved in tab");
    expect(screen.getByText(/Restored the request you saved/)).toBeDefined();
    first.unmount();

    mocks.session = { token: "token", role: "requester", personaLabel: "Priya Raman", workspaceId: "ws-1" };
    const second = render(<IntakeForm />);
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("");
    second.unmount();

    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    const third = render(<NewHarness initial={withTitle("Typed already")} />);
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("Typed already");
    third.unmount();

    for (const bad of ["{not json", JSON.stringify({ payload: { nope: true }, savedAt: 1 })]) {
      window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, bad);
      const view = render(<IntakeForm />);
      expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("");
      view.unmount();
    }
  });

  it("clears the tab copy and goes to the thank-you page after a successful public submit", async () => {
    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    let tabCopyAtCreate: string | null = null;
    mocks.create.mockImplementation(async () => {
      tabCopyAtCreate = window.sessionStorage.getItem(PUBLIC_DRAFT_KEY);
      return created;
    });
    mocks.submit.mockResolvedValue({ submitted: true, completenessPct: 95 });
    render(<NewHarness initial={{ ...SAMPLE_INITIATIVE_PAYLOAD, basics: { ...SAMPLE_INITIATIVE_PAYLOAD.basics, title: "Real title" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/thank-you"));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(JSON.parse(tabCopyAtCreate ?? "null").payload.basics.title).toBe("Real title");
    expect(window.sessionStorage.getItem(PUBLIC_DRAFT_KEY)).toBeNull();
  });

  it("keeps the tab copy and the unload warning when a public submit fails to reach the server", async () => {
    mocks.session = { token: "pub", role: "public", personaLabel: "Public", workspaceId: "public-ws_1" };
    let tabCopyAtCreate: string | null = null;
    mocks.create.mockImplementation(async () => {
      tabCopyAtCreate = window.sessionStorage.getItem(PUBLIC_DRAFT_KEY);
      return created;
    });
    mocks.submit.mockRejectedValue(new TypeError("network down"));
    render(<NewHarness initial={{ ...SAMPLE_INITIATIVE_PAYLOAD, basics: { ...SAMPLE_INITIATIVE_PAYLOAD.basics, title: "Real title" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit intake" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(JSON.parse(tabCopyAtCreate ?? "null").payload.basics.title).toBe("Real title");
    await screen.findByText("Something went wrong — please try again.");
    const stored = JSON.parse(window.sessionStorage.getItem(PUBLIC_DRAFT_KEY) ?? "null");
    expect(stored.payload.basics.title).toBe("Real title");
    expect(unload()).toBe(true);
  });

  it("asks before the sample replaces typed work, not on an empty form", () => {
    const confirm = vi.spyOn(window, "confirm");
    // The sample button exists only in demo mode.
    render(<DeploymentModeProvider mode="demo"><IntakeForm /></DeploymentModeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect(confirm).not.toHaveBeenCalled();
    type("Initiative title", "My own title");
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("My own title");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe(SAMPLE_INITIATIVE_PAYLOAD.basics.title);
    confirm.mockRestore();
  });
});
