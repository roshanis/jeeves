// ReviewWorkbench domain filter buttons — focus ring (WCAG 2.4.7 fix,
// 2026-08-02 — components/jeeves/review-workbench.tsx:142-186). Selected
// chip's bg-primary fill previously swallowed the browser's default focus
// outline entirely.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
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

    const legalButton = screen.getByRole("button", { name: /Legal/ });
    expect(legalButton.className).toContain("focus-visible:ring-2");
    expect(legalButton.className).toContain("focus-visible:ring-offset-background");
  });
});
