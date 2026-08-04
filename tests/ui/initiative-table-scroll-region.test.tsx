// InitiativeTable horizontal-scroll region (WCAG SHOULD-FIX #2, 2026-08-03):
// the overflow-x-auto wrapper had no tabIndex and no accessible name, so a
// keyboard-only user could not scroll it when it overflowed. This locks in
// that the wrapper is a focusable, named, ring-visible region.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import type { InitiativeSummary } from "@/lib/data/dto";

const FLAGS = {
  phi: false,
  memberFacing: false,
  careCoverageInfluence: false,
  vendorHosted: false,
  humanInLoop: true,
  individualImpact: false,
};

function summary(slug: string): InitiativeSummary {
  return {
    slug,
    title: `Initiative ${slug}`,
    tier: "medium",
    state: "in_review",
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

describe("InitiativeTable scroll region", () => {
  it("exposes a keyboard-focusable, named region for the horizontal-scroll wrapper", () => {
    renderWithProviders(<InitiativeTable initiatives={[summary("a")]} caption="A test table" />);

    const region = screen.getByRole("region", { name: "A test table" });
    expect(region.getAttribute("data-slot")).toBe("initiative-table");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("focus-visible:ring-2");
    expect(region.className).toContain("focus-visible:ring-ring");
  });

  it("falls back to a generic accessible name when no caption is supplied", () => {
    renderWithProviders(<InitiativeTable initiatives={[summary("b")]} />);
    expect(screen.getByRole("region")).not.toBeNull();
  });
});
