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

  it("renders a submitter email with mailto parameters as plain text, not a link", async () => {
    const evil = "x@y.example?bcc=evil%40example.com&body=hi";
    mocks.listPublicSubmissions.mockResolvedValue([{ ...ROW, requesterEmail: evil }]);
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");

    await waitFor(() => expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined());
    expect(screen.getByText(evil)).toBeDefined();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("keeps a plus-addressed email as a mailto link", async () => {
    mocks.listPublicSubmissions.mockResolvedValue([{ ...ROW, requesterEmail: "a+b@example.test" }]);
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await waitFor(() => expect(screen.getByRole("link", { name: /a\+b@example\.test/ })).toBeDefined());
  });

  it("keeps the token after a server error and clears it after a 401", async () => {
    window.sessionStorage.setItem("jeeves_operator_token", "the-operator-token");
    mocks.listPublicSubmissions.mockRejectedValueOnce(new ApiError(429, "slow down"));
    renderWithProviders(<PublicIntakeQueue />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    mocks.listPublicSubmissions.mockRejectedValueOnce(new ApiError(500, "boom"));
    unlockWith("the-operator-token");
    await waitFor(() => expect(mocks.listPublicSubmissions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /open queue/i })).toBeDefined());
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBe("the-operator-token");

    mocks.listPublicSubmissions.mockRejectedValue(new ApiError(401, "no"));
    unlockWith("the-operator-token");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not accepted/i));
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBeNull();
  });

  it("on resume, a 500 keeps the token and shows the error", async () => {
    window.sessionStorage.setItem("jeeves_operator_token", "remembered");
    mocks.listPublicSubmissions.mockRejectedValue(new ApiError(500, "boom"));
    renderWithProviders(<PublicIntakeQueue />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBe("remembered");
  });

  it("on resume, a 401 forgets the token", async () => {
    window.sessionStorage.setItem("jeeves_operator_token", "stale");
    mocks.listPublicSubmissions.mockRejectedValue(new ApiError(401, "no"));
    renderWithProviders(<PublicIntakeQueue />);
    await waitFor(() => expect(window.sessionStorage.getItem("jeeves_operator_token")).toBeNull());
  });

  it("lets the operator read a long request in full, hover the title, and refresh", async () => {
    const long = "Members miss appointments. ".repeat(80);
    mocks.listPublicSubmissions.mockResolvedValue([{ ...ROW, businessProblem: long }]);
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await screen.findByText("Appointment Reminder Summarizer");
    expect(screen.getByText("Appointment Reminder Summarizer").getAttribute("title")).toBe(
      "Appointment Reminder Summarizer",
    );
    const problem = document.querySelector('[data-slot="request-problem"]')!;
    expect(problem.className).toContain("line-clamp-3");
    fireEvent.click(screen.getByRole("button", { name: /show full request/i }));
    expect(problem.className).not.toContain("line-clamp-3");
    expect(problem.textContent).toBe(long);

    mocks.listPublicSubmissions.mockClear();
    mocks.listPublicSubmissions.mockResolvedValueOnce([
      ROW,
      { ...ROW, initiativeId: "init-2", title: "Prior Auth Triage Helper" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(mocks.listPublicSubmissions).toHaveBeenCalledWith("the-operator-token"));
    expect(await screen.findByText("Prior Auth Triage Helper")).toBeDefined();
  });

  it("keeps the rows and token on screen when a refresh fails with a 5xx", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await screen.findByText("Appointment Reminder Summarizer");

    mocks.listPublicSubmissions.mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/refresh failed/i);
    expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined();
    expect(document.querySelector('[data-slot="operator-token-input"]')).toBeNull();
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBe("the-operator-token");
  });

  it("drops to the token form when a refresh is rejected with a 401", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await screen.findByText("Appointment Reminder Summarizer");

    mocks.listPublicSubmissions.mockRejectedValueOnce(new ApiError(401, "no"));
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(document.querySelector('[data-slot="operator-token-input"]')).not.toBeNull());
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBeNull();
  });

  it("sends no second request while a refresh is pending", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await screen.findByText("Appointment Reminder Summarizer");

    let resolve!: (rows: unknown[]) => void;
    mocks.listPublicSubmissions.mockClear();
    mocks.listPublicSubmissions.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const button = screen.getByRole("button", { name: /refresh/i }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(mocks.listPublicSubmissions).toHaveBeenCalledTimes(1);
    resolve([ROW]);
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("ignores a refresh that resolves after Lock", async () => {
    renderWithProviders(<PublicIntakeQueue />);
    unlockWith("the-operator-token");
    await waitFor(() => expect(screen.getByText("Appointment Reminder Summarizer")).toBeDefined());

    let resolve!: (rows: unknown[]) => void;
    mocks.listPublicSubmissions.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    fireEvent.click(screen.getByRole("button", { name: /lock/i }));
    resolve([ROW]);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText("Appointment Reminder Summarizer")).toBeNull();
    expect(document.querySelector('[data-slot="operator-token-input"]')).not.toBeNull();
    expect(window.sessionStorage.getItem("jeeves_operator_token")).toBeNull();
  });
});
