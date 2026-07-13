// EvalComparison (components/jeeves/eval-comparison.tsx) — read-only eval
// side-by-side for a promotion candidate vs the current deployed version
// (M3 promotion-view extension). The synthetic-data label is mandatory
// (SyntheticDataLabel wrapper), and the panel must honestly label what is
// being compared since there is no per-checkpoint eval series in the data.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { EvalComparison } from "@/components/jeeves/eval-comparison";
import { renderWithProviders } from "./helpers";

describe("EvalComparison", () => {
  it("renders the latest value, threshold, and a rising-trend arrow when the last point is higher than the previous", () => {
    renderWithProviders(
      <EvalComparison
        candidateVersion="v2.1"
        currentVersion="v2.0"
        evalSeries={{
          kind: "eval_hallucination",
          points: [
            { ts: "2026-06-01T00:00:00.000Z", value: 0.04 },
            { ts: "2026-06-02T00:00:00.000Z", value: 0.06 },
          ],
          threshold: 0.08,
        }}
      />,
    );

    expect(screen.getByText("0.0600")).toBeDefined();
    expect(screen.getByText("threshold 0.0800")).toBeDefined();
    expect(screen.getByText(/rising/)).toBeDefined();
    expect(screen.getByText("Synthetic data — demo")).toBeDefined();
  });

  it("flags the destructive threshold badge when the latest value exceeds the threshold", () => {
    renderWithProviders(
      <EvalComparison
        candidateVersion="v2.1"
        currentVersion="v2.0"
        evalSeries={{
          kind: "eval_hallucination",
          points: [{ ts: "2026-06-01T00:00:00.000Z", value: 0.09 }],
          threshold: 0.08,
        }}
      />,
    );

    expect(screen.getByText(/Currently above threshold/)).toBeDefined();
  });

  it("renders a no-telemetry message when no eval series is available", () => {
    renderWithProviders(
      <EvalComparison candidateVersion="v2.1" currentVersion="v2.0" evalSeries={null} />,
    );
    expect(
      screen.getByText("No eval telemetry is recorded for this initiative."),
    ).toBeDefined();
  });

  it("labels the comparison as the initiative's live series, not a per-checkpoint series (honesty requirement)", () => {
    renderWithProviders(
      <EvalComparison
        candidateVersion="v2.1"
        currentVersion="v2.0"
        evalSeries={{
          kind: "eval_hallucination",
          points: [{ ts: "2026-06-01T00:00:00.000Z", value: 0.04 }],
          threshold: 0.08,
        }}
      />,
    );
    expect(screen.getByText(/live eval series/)).toBeDefined();
  });
});
