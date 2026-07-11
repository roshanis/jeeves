import { describe, expect, it, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { OutcomeMetricsStrip } from "@/components/jeeves/outcome-metrics-strip";
import { getProvider } from "@/lib/data";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

beforeAll(() => {
  installResizeObserverStub();
});

describe("OutcomeMetricsStrip", () => {
  it("renders exactly 5 metric cards", async () => {
    const metrics = await getProvider().outcomeMetrics();
    const { container } = renderWithProviders(
      <OutcomeMetricsStrip metrics={metrics} />,
    );

    const cards = container.querySelectorAll(
      '[data-slot="outcome-metric-card"]',
    );
    expect(cards).toHaveLength(5);
  });

  it("shows the seed-spec outcome metric values", async () => {
    const metrics = await getProvider().outcomeMetrics();
    renderWithProviders(<OutcomeMetricsStrip metrics={metrics} />);

    expect(screen.getByText("11d")).toBeDefined();
    expect(screen.getByText("60%")).toBeDefined();
    expect(screen.getByText("~4h")).toBeDefined();
    expect(screen.getByText("10/12")).toBeDefined();
    expect(screen.getByText("Overdue controls")).toBeDefined();
  });
});
