import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import type { ReviewRow } from "@/lib/data/dto";
import { reviewDecisionReadiness } from "@/lib/approval/review-readiness";

const mocks = vi.hoisted(() => ({ session: vi.fn(), draft: vi.fn(), triage: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...await original<typeof import("@/lib/client/api")>(),
  startDraftRun: mocks.draft,
  runTriage: mocks.triage,
}));
import { ReviewsTab } from "@/components/jeeves/reviews-tab";
import { LiveActionsBar } from "@/components/jeeves/live-actions-bar";

const requester = {
  token: "task-token", workspaceId: "workspace", expiresAt: Date.now() + 60_000,
  personaKey: "priya-raman", personaLabel: "Priya Raman", role: "requester",
};
const review: ReviewRow = {
  cycleId: "server-cycle", domain: "privacy-hipaa", status: "drafted", reviewer: null,
  createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Human-verifiable draft", citations: [],
};
const readiness = (status: string, state: "in_review" | "re_review" = "in_review", cycleOpen = true) => reviewDecisionReadiness({ state, cycleOpen, requiredDomains: ["privacy-hipaa"], reviews: [{ domain: "privacy-hipaa", status }] });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ session: requester, logout: vi.fn() });
  mocks.draft.mockResolvedValue({ cycleId: "server-cycle", outcomes: [{ domain: "privacy-hipaa", status: "drafted" }] });
});

describe("case review continuity", () => {
  it("links each review to its exact evidence workbench and has no second sign/return command owner", () => {
    renderWithProviders(<ReviewsTab reviews={[review]} slug="case one" initiativeId="server-id" isSeeded={false} />);
    expect(screen.getByRole("link", { name: /Open Privacy\/HIPAA review/ }).getAttribute("href"))
      .toBe("/reviews?initiative=case%20one&domain=privacy-hipaa");
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return" })).toBeNull();
    expect(screen.getByText("Human-verifiable draft")).toBeTruthy();
  });

  it("drafts a pending server cycle after reopening the case without a browser registry", async () => {
    renderWithProviders(<ReviewsTab reviews={[{ ...review, status: "pending", draftMd: null }]} slug="reopened" initiativeId="server-id" isSeeded={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start draft run (1 domains)" }));
    await waitFor(() => expect(mocks.draft).toHaveBeenCalledWith("task-token", "server-id", ["privacy-hipaa"]));
  });

  it.each(["sample", "public", "reviewer"])("does not offer batch drafting in %s mode", (mode) => {
    if (mode === "public") mocks.session.mockReturnValue(null);
    if (mode === "reviewer") mocks.session.mockReturnValue({ session: { ...requester, role: "reviewer" } });
    renderWithProviders(<ReviewsTab reviews={[{ ...review, status: "pending" }]} slug="case" initiativeId="server-id" isSeeded={mode === "sample"} />);
    expect(screen.queryByRole("button", { name: /Start draft run/ })).toBeNull();
  });

  it("offers triage for the server-owned submitted case without registry state", () => {
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={false} state="submitted" />);
    expect((screen.getByRole("button", { name: "Run triage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers only the supported human approval decision during reassessment", () => {
    mocks.session.mockReturnValue({ session: { ...requester, role: "approver" } });
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={false} state="re_review" decisionReadiness={readiness("signed", "re_review")} />);
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    expect(screen.getByRole("option", { name: "Approved" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Conditionally approved" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Rejected" })).toBeNull();
  });

  it("offers conditional approval for drafted reviews while full approval is disabled", () => {
    mocks.session.mockReturnValue({ session: { ...requester, role: "approver" } });
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={false} state="in_review" decisionReadiness={readiness("drafted")} />);
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    expect((screen.getByRole("option", { name: "Approved" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("conditionally_approved");
    expect((screen.getByRole("option", { name: "Rejected" }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("keeps rejection independent when reviews are pending", () => {
    mocks.session.mockReturnValue({ session: { ...requester, role: "approver" } });
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={false} state="in_review" decisionReadiness={readiness("pending")} />);
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("rejected");
    expect((screen.getByRole("option", { name: "Conditionally approved" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it.each([readiness("signed", "in_review", false), readiness("drafted", "re_review")])("offers no unavailable decision", (decisionReadiness) => {
    mocks.session.mockReturnValue({ session: { ...requester, role: "approver" } });
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={false} state="re_review" decisionReadiness={decisionReadiness} />);
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
  });

  it.each(["sample", "public"])("keeps the case command bar absent in %s mode", (mode) => {
    if (mode === "public") mocks.session.mockReturnValue(null);
    renderWithProviders(<LiveActionsBar initiativeId="server-id" isSeeded={mode === "sample"} state="submitted" />);
    expect(screen.queryByRole("button", { name: "Run triage" })).toBeNull();
  });
});
