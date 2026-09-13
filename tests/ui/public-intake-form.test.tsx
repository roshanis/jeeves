// The public can submit a request without a passcode.
//
// This reverses what the read-only notice used to say. The notice was
// accurate when it was written — submitting genuinely required a session —
// so the change has to reach the copy as well as the gate, or the form tells
// visitors they cannot do the thing they are about to do.
//
// The passcode path stays exactly where it was. It is still what a demo
// walkthrough uses, and it is still the only way to reach anything past
// submission: QC, triage, the review fan-out and every decision remain with
// named, passcode-holding humans.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { IntakeForm } from "@/components/jeeves/intake-form";

const mocks = vi.hoisted(() => ({ postPublicSession: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/initiatives/new",
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, postPublicSession: mocks.postPublicSession };
});

function render() {
  return renderWithProviders(
    <LiveSessionProvider>
      <IntakeForm />
    </LiveSessionProvider>,
  );
}

describe("IntakeForm — public submission", () => {
  beforeEach(() => {
    resetLiveSessionForTests();
    mocks.postPublicSession.mockReset();
    mocks.postPublicSession.mockResolvedValue({
      token: "public-tok",
      workspaceId: "public-ws_abc",
      expiresAt: Date.now() + 1_800_000,
    });
  });

  afterEach(() => {
    resetLiveSessionForTests();
  });

  it("offers a way to submit without a passcode", () => {
    render();
    expect(screen.getByRole("button", { name: /start a request/i })).toBeDefined();
  });

  it("no longer tells the visitor the form is non-interactive", () => {
    render();
    expect(screen.queryByText(/read-only mode/i)).toBeNull();
    expect(screen.queryByText(/visible but non-interactive/i)).toBeNull();
  });

  it("keeps the demo passcode path available for the walkthrough", () => {
    render();
    expect(screen.getByRole("button", { name: /enter the demo passcode/i })).toBeDefined();
  });

  it("warns against entering real personal or health information", () => {
    render();
    // Strangers will be typing into a form themed as a healthcare payer's
    // intake. Saying this plainly is the cheapest control available.
    expect(screen.getByText(/do not enter real/i)).toBeDefined();
  });

  it("mints a public session and enables the form", async () => {
    render();

    const submitBefore = screen.getAllByRole("button", { name: /submit intake/i })[0]!;
    expect((submitBefore as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /start a request/i }));

    await waitFor(() => expect(mocks.postPublicSession).toHaveBeenCalledTimes(1));
    // No passcode is sent, because there isn't one.
    expect(mocks.postPublicSession).toHaveBeenCalledWith();

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /start a request/i })).toBeNull(),
    );
  });

  it("does not pretend a public submitter is a demo persona", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /start a request/i }));

    await waitFor(() => expect(mocks.postPublicSession).toHaveBeenCalled());
    // The role switcher must not silently show them as Program Office, which
    // is what the defensive persona fallback would otherwise do.
    await waitFor(() => expect(screen.queryByText(/viewing as nia okafor/i)).toBeNull());
  });
});
