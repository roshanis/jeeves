import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { GpuQuotaCard } from "@/components/jeeves/gpu-quota-card";
import type { TelemetrySeries } from "@/lib/data/dto";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

installResizeObserverStub();

/**
 * The card derived its badge from `series.points.some(p => p.value > quota)`
 * — true if utilization EVER crossed the quota — but rendered it as the
 * present tense "Over quota", with an accessible description reading
 * "Currently over quota." Measured on /monitoring against the seeded
 * claims-ocr-coder series: the badge said OVER QUOTA while the latest
 * reading was 25% against an 80% quota.
 *
 * Note the codebase gets this right elsewhere: operate-tab.tsx uses the same
 * `.some()` predicate but labels it "Threshold exceeded" — past tense, which
 * is accurate for an any-time-in-history check. This card was the outlier.
 */

function seriesWith(values: number[], threshold: number | null = 80): TelemetrySeries {
  return {
    kind: "gpu_util_pct",
    threshold,
    points: values.map((value, i) => ({
      ts: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      value,
    })),
  };
}

function labelOfChart(): string {
  return screen.getByRole("img").getAttribute("aria-label") ?? "";
}

describe("GpuQuotaCard — present-tense claims must match the latest reading", () => {
  it("does not claim it is over quota when the latest reading is under it", () => {
    renderWithProviders(
      <GpuQuotaCard slug="claims-ocr-coder" title="Claims OCR" series={seriesWith([95, 90, 25])} />,
    );

    expect(screen.queryByText("Over quota")).toBeNull();
    expect(labelOfChart()).not.toMatch(/currently over quota/i);
  });

  it("still reports that utilization peaked over quota, in the past tense", () => {
    renderWithProviders(
      <GpuQuotaCard slug="claims-ocr-coder" title="Claims OCR" series={seriesWith([95, 90, 25])} />,
    );

    expect(screen.getByText("Peaked over quota")).toBeDefined();
    expect(labelOfChart()).toMatch(/peaked/i);
  });

  it("does claim over quota when the latest reading is actually over it", () => {
    renderWithProviders(
      <GpuQuotaCard slug="claims-ocr-coder" title="Claims OCR" series={seriesWith([20, 30, 95])} />,
    );

    expect(screen.getByText("Over quota")).toBeDefined();
    expect(labelOfChart()).toMatch(/currently over quota/i);
  });

  it("shows no quota badge when utilization never crossed the quota", () => {
    renderWithProviders(
      <GpuQuotaCard slug="claims-ocr-coder" title="Claims OCR" series={seriesWith([20, 30, 40])} />,
    );

    expect(screen.queryByText("Over quota")).toBeNull();
    expect(screen.queryByText("Peaked over quota")).toBeNull();
    expect(labelOfChart()).toMatch(/within quota/i);
  });

  it("makes no quota claim at all when the series has no threshold", () => {
    renderWithProviders(
      <GpuQuotaCard
        slug="claims-ocr-coder"
        title="Claims OCR"
        series={seriesWith([20, 95], null)}
      />,
    );

    expect(screen.queryByText("Over quota")).toBeNull();
    expect(screen.queryByText("Peaked over quota")).toBeNull();
    expect(labelOfChart()).toMatch(/no quota set/i);
  });
});
