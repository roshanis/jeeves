import { describe, expect, it } from "vitest";
import { PipelineBoard } from "@/components/jeeves/pipeline-board";
import { getProvider } from "@/lib/data";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { renderWithProviders } from "./helpers";

// All 12 LifecycleState values (lib/domain/types.ts), one fixture each. Kept
// as an explicit literal record (not derived from the type) so this test
// independently pins the exhaustive set the board must render a column for.
// The `satisfies Record<LifecycleState, true>` below is a compile-time
// exhaustiveness check: it fails to typecheck if LifecycleState gains or
// loses a member without this map being updated to match.
const ALL_LIFECYCLE_STATES_MAP = {
  intake_draft: true,
  submitted: true,
  triaged: true,
  in_review: true,
  fast_lane_approved: true,
  approved: true,
  conditionally_approved: true,
  rejected: true,
  deployed: true,
  paused: true,
  re_review: true,
  retired: true,
} satisfies Record<LifecycleState, true>;

const ALL_LIFECYCLE_STATES = Object.keys(
  ALL_LIFECYCLE_STATES_MAP,
) as LifecycleState[];

function makeInitiative(
  state: LifecycleState,
  index: number,
): InitiativeSummary {
  return {
    slug: `fixture-${state}-${index}`,
    title: `Fixture initiative (${state})`,
    tier: "medium",
    state,
    flags: {
      phi: false,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: false,
      humanInLoop: true,
      individualImpact: false,
    },
    requester: "Test Requester",
    accountableApprover: null,
    domainsRequired: 5,
    domainsSigned: 0,
    overdue: false,
    storyline: "fixture",
  };
}

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

  it("renders a column for every one of the 12 LifecycleState values (exhaustive-columns fix)", () => {
    expect(ALL_LIFECYCLE_STATES).toHaveLength(12);

    const initiatives = ALL_LIFECYCLE_STATES.map((state, i) =>
      makeInitiative(state, i),
    );
    const { container } = renderWithProviders(
      <PipelineBoard initiatives={initiatives} />,
    );

    for (const init of initiatives) {
      const column = container.querySelector(
        `[data-column="${init.state}"]`,
      );
      expect(column).not.toBeNull();
      const cards = column?.querySelectorAll('[data-slot="pipeline-card"]');
      expect(cards).toHaveLength(1);
      expect(column?.textContent).toContain(init.slug);
    }
  });
});
