// InitiativeTable sort-header behavior + the Th button's focus ring
// (WCAG 2.4.7 fix, 2026-08-02 — components/jeeves/initiative-table.tsx:99).
// The Th button already had a browser-default focus outline before this
// fix; this locks in that clicking still toggles sort/direction (unchanged
// behavior) and that the new explicit focus-visible ring classes are
// present (uniform with the other pill filters fixed in the same pass).
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
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
  title: string,
  tier: Tier,
  state: LifecycleState = "in_review",
): InitiativeSummary {
  return {
    slug,
    title,
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

describe("InitiativeTable sort headers", () => {
  it("sorts by tier ascending by default, then toggles direction on repeat click", () => {
    const rows = [
      summary("low-one", "Low initiative", "low"),
      summary("crit-one", "Critical initiative", "critical"),
      summary("high-one", "High initiative", "high"),
    ];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);

    // Default sort key is "tier", ascending -> critical first.
    let titles = screen.getAllByRole("link").map((a) => a.textContent);
    expect(titles[0]).toBe("Critical initiative");

    // Clicking the Tier header again flips the direction -> low first.
    fireEvent.click(screen.getByRole("button", { name: /Tier/ }));
    titles = screen.getAllByRole("link").map((a) => a.textContent);
    expect(titles[0]).toBe("Low initiative");
  });

  it("switches the active sort column on click (Initiative -> alphabetical)", () => {
    const rows = [
      summary("b", "Bravo initiative", "medium"),
      summary("a", "Alpha initiative", "medium"),
    ];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);

    fireEvent.click(screen.getByRole("button", { name: /Initiative/ }));
    const titles = screen.getAllByRole("link").map((a) => a.textContent);
    expect(titles[0]).toBe("Alpha initiative");
  });

  it("every sort-header button carries a visible focus-visible ring (WCAG 2.4.7)", () => {
    const rows = [summary("a", "Alpha initiative", "medium")];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);

    const headerButton = screen.getByRole("button", { name: /Tier/ });
    expect(headerButton.className).toContain("focus-visible:ring-2");
    expect(headerButton.className).toContain("focus-visible:ring-offset-background");
  });
});
