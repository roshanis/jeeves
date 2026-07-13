import { describe, expect, it, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { CostBudgetCard } from "@/components/jeeves/cost-budget-card";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

beforeAll(() => {
  installResizeObserverStub();
});

describe("CostBudgetCard", () => {
  it("renders the daily token budget reference and Synthetic data label", () => {
    renderWithProviders(
      <CostBudgetCard
        points={[
          { ts: "2026-07-01T00:00:00.000Z", totalUsd: 100 },
          { ts: "2026-07-02T00:00:00.000Z", totalUsd: 120 },
        ]}
      />,
    );

    expect(screen.getByText("Synthetic data — demo")).toBeDefined();
    expect(screen.getByText(/Daily token budget: 500,000/)).toBeDefined();
  });

  it("renders a fallback message when there are no cost points", () => {
    renderWithProviders(<CostBudgetCard points={[]} />);
    expect(screen.getByText("No cost telemetry available.")).toBeDefined();
  });
});
