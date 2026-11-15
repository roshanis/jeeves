import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";

const OLD = "2020-01-01T00:00:00.000Z"; // far past -> "overdue" bucket

const FLAGS = {
  phi: false,
  memberFacing: false,
  careCoverageInfluence: false,
  vendorHosted: false,
  humanInLoop: true,
  individualImpact: false,
};

function summary(overrides: Partial<InitiativeSummary> & { slug: string; state: LifecycleState }): InitiativeSummary {
  return {
    slug: overrides.slug,
    title: overrides.title ?? `Initiative ${overrides.slug}`,
    tier: overrides.tier ?? "high",
    state: overrides.state,
    flags: FLAGS,
    requester: overrides.requester ?? "Priya Raman",
    accountableApprover: overrides.accountableApprover ?? null,
    domainsRequired: overrides.domainsRequired ?? 4,
    domainsSigned: overrides.domainsSigned ?? 1,
    overdue: overrides.overdue ?? false,
    storyline: overrides.storyline ?? "in-review",
    updatedAt: "updatedAt" in overrides ? overrides.updatedAt : OLD,
  };
}

describe("InitiativeTable time-in-state aging", () => {
  it("shows a colored Age for active states and a muted Age for settled states", () => {
    const rows = [
      summary({ slug: "waiting", state: "in_review", updatedAt: OLD }),
      summary({ slug: "settled", state: "deployed", updatedAt: OLD }),
    ];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);

    // Age column header present.
    expect(screen.getByText("Age")).toBeDefined();

    // Active (in_review) state: colored by bucket — old -> overdue (destructive).
    const activeCell = screen.getByTitle(/In "In Review" since/);
    expect(activeCell.textContent).toMatch(/\d+d/);
    expect(activeCell.className).toContain("text-destructive");

    // Settled (deployed) state: muted, never the overdue color.
    const settledCell = screen.getByTitle(/In "Deployed" since/);
    expect(settledCell.textContent).toMatch(/\d+d/);
    expect(settledCell.className).toContain("text-muted-foreground");
    expect(settledCell.className).not.toContain("text-destructive");
  });

  it("renders a dash when an initiative has no updatedAt", () => {
    const rows = [summary({ slug: "no-ts", state: "in_review", updatedAt: undefined })];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);
    // No age cell carries a "since" title when the timestamp is absent.
    expect(screen.queryByTitle(/ since /)).toBeNull();
  });
});

describe("InitiativeTable next action and owner", () => {
  it("names promotion, not automatic steps, for approved states", () => {
    const rows = [
      summary({ slug: "a", state: "approved" }),
      summary({ slug: "f", state: "fast_lane_approved" }),
      summary({ slug: "c", state: "conditionally_approved" }),
    ];
    renderWithProviders(<InitiativeTable initiatives={rows} caption="test" />);
    expect(screen.queryByText("Generate controls")).toBeNull();
    expect(screen.getAllByText("Promote / deploy")).toHaveLength(2);
    expect(screen.getByText("Meet conditions, then promote")).toBeDefined();
  });

  it("exposes the owner full name as text, not only a title", () => {
    renderWithProviders(<InitiativeTable initiatives={[summary({ slug: "o", state: "in_review" })]} caption="test" />);
    expect(screen.getByText("Priya Raman")).toBeDefined();
  });
});
