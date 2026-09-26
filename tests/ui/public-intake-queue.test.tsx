// The operator's queue of real requests.
//
// Opened by the site's OPERATOR_TOKEN — never by the demo persona. The
// passwordless playground hands every persona to every visitor, so the test
// that matters most here is that no session of any kind opens this panel on
// its own: the queue only ever loads after a token is entered.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ApiError } from "@/lib/client/api";

const mocks = vi.hoisted(() => ({ listPublicSubmissions: vi.fn() }));

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
  requesterEmail: "jordan.ellis@example.test",
  businessProblem: "Members miss appointments because reminder calls are manual.",
  state: "submitted",
  submittedAt: "2026-09-13T00:00:00.000Z",
  createdAt: "2026-09-13T00:00:00.000Z",
};

function unlockWith(token: string) {
  fireEvent.change(document.querySelector('[data-slot="operator-token-input"]')!, {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole("button", { name: /open queue/i }));
}

describe("PublicIntakeQueue (operator)", () => {
  beforeEach(() => {
    mocks.listPublicSubmissions.mockReset();
    mocks.listPublicSubmissions.mockResolvedValue([ROW]);
    window.sessionStorage.clear();
  });

  it("asks for the operator token and loads nothing until one is given", () => {
    renderWithProviders(<PublicIntakeQueue />);
    expect(document.querySelector('[data-slot="operator-token-input"]')).not.toBeNull();
    expect(mocks.listPublicSubmissions).not.toHaveBeenCalled();
  });

  it("says plainly that a demo persona does not open it", () => {
    renderWithProviders(<PublicIntakeQueue />);
    expect(screen.getByText(/demo persona does not open this queue/i)).toBeDefined();
  });

  it("lists requests with a reply link once unlocked", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");

    await waitFor(() => expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined());
    expect(mocks.listPublicSubmissions).toHaveBeenCalledWith("the-operator-token");
    const reply = screen.getByRole("link", { name: /jordan\.ellis@example\.test/ });
    expect(reply.getAttribute("href")).toBe("mailto:jordan.ellis@example.test");
  });

  it("reports a rejected token without revealing anything", async () => {
    mocks.listPublicSubmissions.mockRejectedValue(new ApiError(401, "operator token required"));
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("wrong");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not accepted/i));
    expect(screen.queryByText("Appointment Reminder Summarizer")).toBeNull();
  });

  it("explains a queue that is switched off, rather than calling it a bad token", async () => {
    mocks.listPublicSubmissions.mockRejectedValue(new ApiError(404, "not found"));
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("anything");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not switched on/i));
  });

  it("forgets the token when locked", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await waitFor(() => expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /lock/i }));
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBeNull();
    expect(screen.queryByText("Appointment Reminder Summarizer")).toBeNull();
  });
});
