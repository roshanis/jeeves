// RiskHeatmap bucket-4 ink (WCAG 1.4.3 fix, 2026-08-02): the numeric label
// on a bucket-4 cell (text-white on --seq-4) measured 4.06:1 light / 3.48:1
// dark against a 4.5:1 requirement. --seq-4 was darkened for light mode
// (app/globals.css) and bucket 4 now switches ink per theme the same way
// bucket 5 already did, so this locks in the class change rather than the
// (untestable-in-jsdom) rendered color itself.
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./helpers";
import { RiskHeatmap } from "@/components/jeeves/risk-heatmap";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState, Tier } from "@/lib/domain/types";

const FLAGS = {
  phi: false,
  memberFacing: false,
  careCoverageInfluence: false,
  vendorHosted: false,
  humanInLoop: true,
  individualImpact: false,
};

function summary(slug: string, tier: Tier, state: LifecycleState): InitiativeSummary {
  return {
    slug,
    title: `Initiative ${slug}`,
    tier,
    state,
    flags: FLAGS,
    requester: "Priya Raman",
    accountableApprover: null,
    domainsRequired: 4,
    domainsSigned: 4,
    overdue: false,
    storyline: "deployed",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("RiskHeatmap bucket ink", () => {
  it("a bucket-4 cell switches ink per theme (text-white dark:text-neutral-900), matching bucket 5", () => {
    // 5 "critical / All signed" rows -> bucket 5 (the grid's max cell);
    // pair it with fewer "high / All signed" rows so that cell buckets to
    // 4 (80% of the max), giving us a real, addressable bucket-4 cell.
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => summary(`c${i}`, "critical", "deployed")),
      ...Array.from({ length: 4 }, (_, i) => summary(`h${i}`, "high", "deployed")),
    ];
    const { container } = renderWithProviders(<RiskHeatmap initiatives={rows} />);

    const bucket4Cell = container.querySelector('[data-slot="risk-heatmap-cell"][data-bucket="4"]');
    expect(bucket4Cell).not.toBeNull();
    expect(bucket4Cell?.className).toContain("text-white");
    expect(bucket4Cell?.className).toContain("dark:text-neutral-900");
  });
});
