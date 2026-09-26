// The intake page offers two ways in, and they go to different places.
//
// "Start the demo" is the passwordless playground: a requester persona in the
// visitor's own sandbox, where they can switch roles and review their own
// fictional initiative. Nothing leaves it. "Send a real request" is a
// `public` session whose submission reaches the site's operators.
//
// The copy is the control here. A visitor has to be able to tell which door
// reaches a human before they type anything, so the tests pin the wording as
// well as the wiring.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { IntakeForm } from "@/components/jeeves/intake-form";

const mocks = vi.hoisted(() => ({ postPublicSession: vi.fn(), postSession: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/initiatives/new",
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, postPublicSession: mocks.postPublicSession, postSession: mocks.postSession };
});

function render() {
  return renderWithProviders(
    <LiveSessionProvider>
      <IntakeForm />
    </LiveSessionProvider>,
  );
}

describe("IntakeForm — two ways in", () => {
  beforeEach(() => {
    resetLiveSessionForTests();
    mocks.postPublicSession.mockReset();
    mocks.postPublicSession.mockResolvedValue({
      token: "public-tok",
      workspaceId: "public-ws_abc",
      expiresAt: Date.now() + 1_800_000,
    });
    mocks.postSession.mockReset();
  });

  afterEach(() => {
    resetLiveSessionForTests();
  });

  it("offers both doors, labelled for where they lead", () => {
    render();
    expect(screen.getByRole("button", { name: /start the demo/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /send a real request/i })).toBeDefined();
    // The sentence that makes the choice an informed one.
    expect(screen.getByText(/stays in your own sandbox/i)).toBeDefined();
    expect(screen.getByText(/goes to the team running this site/i)).toBeDefined();
  });

  it("mentions no passcode — there isn't one any more", () => {
    render();
    expect(screen.queryByText(/passcode/i)).toBeNull();
  });

  it("warns against entering real personal or health information", () => {
    render();
    expect(screen.getByText(/do not enter real/i)).toBeDefined();
  });

  it("'Send a real request' starts a public session — not a demo persona — and says where it goes", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /send a real request/i }));

    await waitFor(() => expect(mocks.postPublicSession).toHaveBeenCalledTimes(1));
    expect(mocks.postPublicSession).toHaveBeenCalledWith();
    expect(mocks.postSession).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText(/sending a real request/i)).toBeDefined());
    expect(screen.getByText(/not into the demo/i)).toBeDefined();
  });

  it("does not present a real-request sender as a demo persona", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /send a real request/i }));
    await waitFor(() => expect(mocks.postPublicSession).toHaveBeenCalled());
    // The persona fallback would otherwise show them as the Program Office.
    await waitFor(() => expect(screen.queryByText(/viewing as/i)).toBeNull());
  });

  it("coalesces a double click into one session", async () => {
    render();
    const send = screen.getByRole("button", { name: /send a real request/i });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(mocks.postPublicSession).toHaveBeenCalledTimes(1));
  });
});
