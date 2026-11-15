// Sign/Return disabled reasons in ReviewWorkbench: a live review that cannot be signed
// must not be called "a read-only example" (only seeded rows are).
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/client/evidence-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/evidence-api")>()),
  evidenceRequest: vi.fn(async () => { throw new Error("offline"); }),
}));
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";

function describedBy(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function row(over: Partial<ReviewQueueRow> & { review?: Partial<ReviewQueueRow["review"]> }): ReviewQueueRow {
  return {
    slug: "a", title: "Initiative a", tier: "high", isSeeded: false,
    ...over,
    review: { domain: "legal", status: "drafted", reviewer: null, createdAt: "2020-01-01T00:00:00.000Z", signedAt: null, draftMd: "draft", citations: [], cycleId: "c1", cycleOpen: false, revision: 1, ...over.review },
  } as ReviewQueueRow;
}

function renderRow(r: ReviewQueueRow) {
  resetLiveSessionForTests();
  sessionStorage.setItem("jeeves_live_session", JSON.stringify({ token: "tok", workspaceId: "w-1", expiresAt: Date.now() + 60_000, personaKey: "james-liu", personaLabel: "James Liu", role: "reviewer" }));
  renderWithProviders(<LiveSessionProvider><ReviewWorkbench rows={[r]} selection={{ slug: r.slug, domain: r.review.domain }} /></LiveSessionProvider>);
}

describe("ReviewWorkbench disabled Sign/Return reasons", () => {
  it("does not call a closed live review a read-only example", async () => {
    renderRow(row({}));
    const sign = screen.getByRole("button", { name: "Sign" });
    await waitFor(() => expect(describedBy(sign)).not.toBe("Start the demo to try this action"));
    expect(describedBy(sign)).not.toMatch(/read-only example/);
    expect(describedBy(sign)).toBe("This review is not open for signing right now");
    expect(describedBy(screen.getByRole("button", { name: "Return" }))).not.toMatch(/signing/);
    resetLiveSessionForTests();
  });

  it("still calls a seeded row a read-only example", async () => {
    renderRow(row({ isSeeded: true }));
    await waitFor(() => expect(describedBy(screen.getByRole("button", { name: "Sign" }))).toMatch(/read-only example/));
    resetLiveSessionForTests();
  });
});
