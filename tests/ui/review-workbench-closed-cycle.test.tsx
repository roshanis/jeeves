import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const row = (slug: string, cycleOpen: boolean): ReviewQueueRow => ({
  slug,
  title: `Initiative ${slug}`,
  tier: "high",
  review: { domain: "security", status: "drafted", cycleOpen, reviewer: null, createdAt: "2020-01-01T00:00:00.000Z", signedAt: null, draftMd: "draft", citations: [] },
});

describe("ReviewWorkbench closed cycles (L30)", () => {
  it("labels an unsigned draft of a closed cycle, and only that one", () => {
    renderWithProviders(<ReviewWorkbench rows={[row("open", true), row("closed", false)]} />);
    expect(screen.getAllByText("Cycle closed")).toHaveLength(1);
  });
});
