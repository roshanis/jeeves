// PortfolioView saved-view tabs — behavior (switching views still filters
// the table) plus the focus-visible ring added to the tab buttons (WCAG
// 2.4.7 fix, 2026-08-02 — components/jeeves/portfolio-view.tsx:42, the
// selected tab's bg-primary fill previously swallowed the browser's default
// focus outline).
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { PortfolioView } from "@/components/jeeves/portfolio-view";
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

function summary(
  slug: string,
  tier: Tier,
  state: LifecycleState,
): InitiativeSummary {
  return {
    slug,
    title: `Initiative ${slug}`,
    tier,
    state,
    flags: FLAGS,
    requester: "Priya Raman",
    accountableApprover: null,
    domainsRequired: 4,
    domainsSigned: 1,
    overdue: false,
    storyline: "in-review",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("PortfolioView saved views", () => {
  it("narrows the table to the tier-critical row set when 'Critical' is selected", () => {
    const rows = [
      summary("crit-a", "critical", "in_review"),
      summary("high-a", "high", "in_review"),
    ];
    renderWithProviders(<PortfolioView initiatives={rows} />);

    expect(screen.getAllByRole("link", { name: /Initiative/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: /Critical/ }));

    const links = screen.getAllByRole("link", { name: /Initiative/ });
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain("crit-a");
  });

  it("every saved-view tab carries a visible focus-visible ring (WCAG 2.4.7)", () => {
    const rows = [summary("a", "high", "in_review")];
    renderWithProviders(<PortfolioView initiatives={rows} />);

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("focus-visible:ring-2");
      expect(tab.className).toContain("focus-visible:ring-offset-background");
    }
  });
});
