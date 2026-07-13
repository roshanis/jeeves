// DeploymentHistory (components/jeeves/deployment-history.tsx) — read-only
// per-initiative deployment-version timeline (M3 promotion-view extension).
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DeploymentHistory, type DeploymentHistoryEntryLike } from "@/components/jeeves/deployment-history";
import { renderWithProviders } from "./helpers";

const ENTRIES: DeploymentHistoryEntryLike[] = [
  {
    id: "dep-2",
    version: "v2.1",
    status: "awaiting_promotion_signoff",
    modelVersion: "meridian-correspondence-2.1-checkpoint",
    deployedAt: "2026-06-25T00:00:00.000Z",
    pausedAt: null,
    retiredAt: null,
    isCurrent: false,
  },
  {
    id: "dep-1",
    version: "v2.0",
    status: "deployed",
    modelVersion: "meridian-correspondence-2.0",
    deployedAt: "2026-04-11T00:00:00.000Z",
    pausedAt: null,
    retiredAt: null,
    isCurrent: true,
  },
];

describe("DeploymentHistory", () => {
  it("renders every entry's version and status", () => {
    renderWithProviders(<DeploymentHistory title="Prior-Auth Correspondence Drafting Model" entries={ENTRIES} />);

    expect(screen.getByText("v2.1")).toBeDefined();
    expect(screen.getByText("v2.0")).toBeDefined();
    expect(screen.getByText("Awaiting sign-off")).toBeDefined();
    expect(screen.getByText("Deployed")).toBeDefined();
  });

  it("marks exactly the current (isCurrent) entry with a Current badge", () => {
    renderWithProviders(<DeploymentHistory title="x" entries={ENTRIES} />);
    expect(screen.getByText("Current")).toBeDefined();
  });

  it("renders an empty state when there are no entries", () => {
    renderWithProviders(<DeploymentHistory title="x" entries={[]} />);
    expect(
      screen.getByText("No deployment versions recorded for this initiative."),
    ).toBeDefined();
  });
});
