import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./helpers";
const mocks = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn(), mutate: vi.fn(), session: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({ ...await original<typeof import("@/lib/client/api")>(), runReviewAgent: mocks.run }));
vi.mock("@/lib/client/review-actions", async (original) => ({ ...await original<typeof import("@/lib/client/review-actions")>(), performReviewMutation: mocks.mutate }));
vi.mock("@/components/jeeves/review-evidence-workspace", () => ({ ReviewEvidenceWorkspace: ({ children }: { children: (props: unknown) => unknown }) => children({ signingBlock: null, cycleId: "cycle", cycleChanged: false }) }));
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { ApiError } from "@/lib/client/api";
const session = { token: "test-reviewer", personaKey: "marcus-webb", role: "reviewer", workspaceId: "w", expiresAt: 9999999999999 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ session, logout: mocks.logout });
});
const rows: ReviewQueueRow[] = ["one", "two"].map((slug) => ({ slug, title: `Case ${slug}`, tier: "high", isSeeded: false, review: {
  cycleId: "cycle", draftToken: "a".repeat(64), domain: "privacy-hipaa", status: "drafted", reviewer: null,
  createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Existing server draft", citations: [],
} }));
function Harness() {
  const [slug, setSlug] = useState("one");
  return <><button onClick={() => setSlug("one")}>Back to first</button><button onClick={() => setSlug("two")}>Other review</button><ReviewWorkbench rows={rows} selection={{ slug, domain: "privacy-hipaa" }} /></>;
}
it("does not erase newer edits after an old unmounted agent request completes", async () => {
  let complete!: (result: unknown) => void;
  mocks.run.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  renderWithProviders(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Re-run agent" }));
  expect(mocks.run).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Other review" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to first" }));
  fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "New human edits written after returning" } });
  await act(async () => complete({ status: "drafted", draftMd: "Fresh server draft" }));
  await waitFor(() => expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("New human edits written after returning"));
});

it.each(["run", "sign", "return"])("ignores a stale %s 401 after a new session mounts", async (action) => {
  let reject!: (error: Error) => void;
  const pending = new Promise((_, rejectRequest) => { reject = rejectRequest; });
  (action === "run" ? mocks.run : mocks.mutate).mockReturnValue(pending);
  const old = renderWithProviders(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: action === "run" ? "Re-run agent" : action === "sign" ? "Sign" : "Return" }));
  if (action === "return") {
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Needs revised evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Return review" }));
  }
  expect(action === "run" ? mocks.run : mocks.mutate).toHaveBeenCalledOnce();
  old.unmount();
  mocks.session.mockReturnValue({ session: { ...session, token: "new-session" }, logout: mocks.logout });
  renderWithProviders(<Harness />);
  await act(async () => reject(new ApiError(401, "Old session expired")));
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
