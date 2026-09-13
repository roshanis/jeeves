// The Program Office's view of what the public has sent in.
//
// The panel exists because public submissions are invisible to the console
// by construction: each public session gets its own isolated workspace, and
// the server-rendered console scopes reads by the workspace cookie, which
// carries no role. The role only exists on the session token — which is why
// this is a client component, and why the test that matters most is that it
// renders NOTHING for anyone who should not see it. The console is public.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({ listPublicSubmissions: vi.fn() }));

let sessionValue: { token: string; role: string } | null = null;

vi.mock("@/lib/client/session-context", () => ({
  useLiveSessionOptional: () => (sessionValue ? { session: sessionValue, logout: vi.fn() } : null),
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, listPublicSubmissions: mocks.listPublicSubmissions };
});

const { PublicIntakeQueue } = await import("@/components/jeeves/public-intake-queue");

const ROW = {
  initiativeId: "init-1",
  slug: "appointment-reminder-summarizer",
  title: "Appointment Reminder Summarizer",
  requester: "Jordan Ellis",
  state: "submitted",
  submittedAt: "2026-09-13T00:00:00.000Z",
  createdAt: "2026-09-13T00:00:00.000Z",
};

describe("PublicIntakeQueue", () => {
  beforeEach(() => {
    mocks.listPublicSubmissions.mockReset();
    mocks.listPublicSubmissions.mockResolvedValue([ROW]);
    sessionValue = null;
  });

  it("renders nothing for an anonymous visitor", () => {
    const { container } = renderWithProviders(<PublicIntakeQueue />);
    expect(container.querySelector('[data-slot="public-intake-queue"]')).toBeNull();
    expect(mocks.listPublicSubmissions).not.toHaveBeenCalled();
  });

  it("renders nothing for a public submitter — strangers do not read each other's requests", () => {
    sessionValue = { token: "public-tok", role: "public" };
    const { container } = renderWithProviders(<PublicIntakeQueue />);
    expect(container.querySelector('[data-slot="public-intake-queue"]')).toBeNull();
    expect(mocks.listPublicSubmissions).not.toHaveBeenCalled();
  });

  it("renders nothing for a requester persona", () => {
    sessionValue = { token: "req-tok", role: "requester" };
    const { container } = renderWithProviders(<PublicIntakeQueue />);
    expect(container.querySelector('[data-slot="public-intake-queue"]')).toBeNull();
  });

  it("shows the queue to the Program Office", async () => {
    sessionValue = { token: "program-tok", role: "program" };
    renderWithProviders(<PublicIntakeQueue />);

    await waitFor(() => expect(mocks.listPublicSubmissions).toHaveBeenCalledWith("program-tok"));
    await waitFor(() =>
      expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined(),
    );
    expect(screen.getByText(/Jordan Ellis/)).toBeDefined();
  });

  it("says plainly that an arriving request still needs QC", async () => {
    sessionValue = { token: "admin-tok", role: "admin" };
    mocks.listPublicSubmissions.mockResolvedValue([]);
    renderWithProviders(<PublicIntakeQueue />);

    await waitFor(() => expect(screen.getByText(/still need QC/i)).toBeDefined());
  });
});
