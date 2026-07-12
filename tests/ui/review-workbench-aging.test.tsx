import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import type { ReviewRow } from "@/lib/data/dto";

const OLD = "2020-01-01T00:00:00.000Z"; // far in the past -> always "overdue"

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

describe("ReviewWorkbench queue aging", () => {
  it("renders an Age column and a waiting-age badge for unsigned reviews only", () => {
    const rows = [
      queueRow({ slug: "a", domain: "privacy-hipaa", status: "drafted", createdAt: OLD }),
      queueRow({
        slug: "b",
        domain: "legal",
        status: "signed",
        reviewer: "James Liu",
        createdAt: OLD,
        signedAt: OLD,
      }),
    ];
    renderWithProviders(<ReviewWorkbench rows={rows} />);

    // The Age column header exists.
    expect(screen.getByText("Age")).toBeDefined();

    // Only the unsigned (drafted) row gets a per-row age badge (title carries
    // the queue-entry date); the signed row shows a dash, no such title.
    const ageCells = screen.getAllByTitle(/In queue since/);
    expect(ageCells).toHaveLength(1);
    // An old createdAt reads as a day count (overdue).
    expect(ageCells[0].textContent).toMatch(/\d+d/);
  });

  it("shows each domain queue's oldest-waiting age on its filter chip", () => {
    const rows = [
      queueRow({ slug: "a", domain: "privacy-hipaa", status: "drafted", createdAt: OLD }),
    ];
    renderWithProviders(<ReviewWorkbench rows={rows} />);

    // "All domains" chip + the privacy-hipaa chip each carry a queue-aging badge.
    const queueAging = screen.getAllByTitle("Oldest review waiting in this queue");
    expect(queueAging.length).toBeGreaterThanOrEqual(1);
    expect(queueAging[0].textContent).toMatch(/\d+d/);
  });
});
