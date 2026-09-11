import { describe, expect, it } from "vitest";
import { EvalComparison } from "@/components/jeeves/eval-comparison";
import type { TelemetrySeries } from "@/lib/data/dto";
import { renderWithProviders } from "./helpers";

/**
 * Regression guard for a JSX whitespace bug.
 *
 * The source read `{metricLabel} compared: the initiative's...` — with a
 * real space in the file — but the text node that follows the expression
 * spans several lines, and its leading whitespace is trimmed when the lines
 * are joined. The rendered DOM on /promotions was
 * "Hallucination ratecompared:". Asserting on textContent is the point: the
 * source looks correct, so only the rendered output catches it.
 */

const series: TelemetrySeries = {
  kind: "eval_hallucination",
  threshold: 0.05,
  points: [
    { ts: "2026-07-10T00:00:00Z", value: 0.04 },
    { ts: "2026-07-15T00:00:00Z", value: 0.0319 },
  ],
};

describe("EvalComparison — rendered copy", () => {
  it("keeps a space between the metric label and the following prose", () => {
    const { container } = renderWithProviders(
      <EvalComparison candidateVersion="v2.1" currentVersion="v2.0" evalSeries={series} />,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Hallucination rate compared:");
    expect(text).not.toContain("ratecompared");
  });
});
