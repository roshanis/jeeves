import { describe, expect, it } from "vitest";
import { PipelineBoard } from "@/components/jeeves/pipeline-board";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

describe("PipelineBoard", () => {
  it("renders all 12 initiatives as cards", async () => {
    const initiatives = await getProvider().listInitiatives();
    const { container } = renderWithProviders(
      <PipelineBoard initiatives={initiatives} />,
    );

    const cards = container.querySelectorAll('[data-slot="pipeline-card"]');
    expect(cards).toHaveLength(12);
    for (const init of initiatives) {
      expect(container.textContent).toContain(init.slug);
    }
  });

  it("groups initiatives into the correct lifecycle-state columns", async () => {
    const initiatives = await getProvider().listInitiatives();
    const { container } = renderWithProviders(
      <PipelineBoard initiatives={initiatives} />,
    );

    const cardsIn = (state: string) =>
      container.querySelectorAll(
        `[data-column="${state}"] [data-slot="pipeline-card"]`,
      );

    // Seeded distribution (seed-spec §2): champion in intake_draft, 2 in
    // review, 1 conditional, 1 approved, 6 deployed, 1 rejected.
    expect(cardsIn("intake_draft")).toHaveLength(1);
    expect(cardsIn("in_review")).toHaveLength(2);
    expect(cardsIn("conditionally_approved")).toHaveLength(1);
    expect(cardsIn("approved")).toHaveLength(1);
    expect(cardsIn("deployed")).toHaveLength(6);
    expect(cardsIn("rejected")).toHaveLength(1);
    expect(cardsIn("paused")).toHaveLength(0);

    // Spot-check specific placements.
    expect(
      container.querySelector('[data-column="intake_draft"]')?.textContent,
    ).toContain("prior-auth-summarizer");
    expect(
      container.querySelector('[data-column="rejected"]')?.textContent,
    ).toContain("social-sentiment-miner");
    expect(
      container.querySelector('[data-column="approved"]')?.textContent,
    ).toContain("hr-resume-screener");
  });

  it("renders an empty-column message for empty states", async () => {
    const initiatives = await getProvider().listInitiatives();
    const { container } = renderWithProviders(
      <PipelineBoard initiatives={initiatives} />,
    );
    expect(
      container.querySelector('[data-column="paused"]')?.textContent,
    ).toContain("No initiatives in Paused");
  });
});
