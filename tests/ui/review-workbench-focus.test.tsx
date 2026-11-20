// ReviewWorkbench domain filter buttons — focus ring (WCAG 2.4.7 fix,
// 2026-08-02 — components/jeeves/review-workbench.tsx:142-186). Selected
// chip's bg-primary fill previously swallowed the browser's default focus
// outline entirely.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import type { ReviewRow } from "@/lib/data/dto";

const OLD = "2020-01-01T00:00:00.000Z";

function queueRow(overrides: Partial<ReviewRow> & { slug: string; domain: ReviewRow["domain"] }): ReviewQueueRow {
  const { slug, ...review } = overrides;
  return {
    slug,
    title: `Initiative ${slug}`,
    tier: "high",
    review: {
      domain: review.domain,
      status: review.status ?? "drafted",
      reviewer: review.reviewer ?? null,
      createdAt: review.createdAt ?? OLD,
      signedAt: review.signedAt ?? null,
      draftMd: review.draftMd ?? "draft",
      citations: review.citations ?? [],
    },
  };
}

describe("ReviewWorkbench domain filter focus rings", () => {
  it("the 'All domains' button and every present-domain chip carry a visible focus-visible ring", () => {
    const rows = [
      queueRow({ slug: "a", domain: "privacy-hipaa" }),
      queueRow({ slug: "b", domain: "legal" }),
    ];
    renderWithProviders(<ReviewWorkbench rows={rows} />);

    const allButton = screen.getByRole("button", { name: /All domains/ });
    expect(allButton.className).toContain("focus-visible:ring-2");
    expect(allButton.className).toContain("focus-visible:ring-offset-background");

    const legalButton = screen.getByRole("button", { name: /^Legal/ });
    expect(legalButton.className).toContain("focus-visible:ring-2");
    expect(legalButton.className).toContain("focus-visible:ring-offset-background");
  });
});

describe("ReviewWorkbench focus management on select / change review", () => {
  const rows = [
    queueRow({ slug: "a", domain: "privacy-hipaa" }),
    queueRow({ slug: "b", domain: "privacy-hipaa" }),
  ];

  it("moves focus to the review heading after choosing a row, and back to that row after 'Change review'", async () => {
    renderWithProviders(<ReviewWorkbench rows={rows} />);

    const rowButton = screen.getByRole("button", { name: /Open .* review for Initiative b/ });
    rowButton.focus();
    fireEvent.click(rowButton);
    const heading = await screen.findByRole("heading", { level: 2, name: /review$/ });
    expect(document.activeElement).toBe(heading);

    fireEvent.click(screen.getByRole("button", { name: "Change review" }));
    const back = screen.getByRole("button", { name: /Open .* review for Initiative b/ });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(back);
    expect(back.getAttribute("aria-current")).toBe("true");
  });

  it("does not steal focus on first render with a preselected review", () => {
    renderWithProviders(<ReviewWorkbench rows={rows} selection={{ slug: "a", domain: "privacy-hipaa" }} />);
    expect(document.activeElement).toBe(document.body);
  });
});
