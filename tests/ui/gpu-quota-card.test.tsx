import { describe, expect, it, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { GpuQuotaCard } from "@/components/jeeves/gpu-quota-card";
import { getProvider } from "@/lib/data";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

beforeAll(() => {
  installResizeObserverStub();
});

describe("GpuQuotaCard", () => {
  it("renders the GPU quota line and Synthetic data label for claims-ocr-coder", async () => {
    const detail = await getProvider().getInitiativeDetail("claims-ocr-coder");
    expect(detail).not.toBeNull();
    const gpuSeries = detail!.telemetry.find((t) => t.kind === "gpu_util_pct");
    expect(gpuSeries).toBeDefined();

    renderWithProviders(
      <GpuQuotaCard
        slug={detail!.summary.slug}
        title={detail!.summary.title}
        series={gpuSeries!}
      />,
    );

    expect(screen.getByText("GPU quota: 80%")).toBeDefined();
    expect(screen.getByText("Synthetic data — demo")).toBeDefined();
  });

  it("shows an Over quota marker when a point exceeds the threshold", async () => {
    const detail = await getProvider().getInitiativeDetail("claims-ocr-coder");
    const gpuSeries = detail!.telemetry.find((t) => t.kind === "gpu_util_pct")!;

    // Force an over-quota point deterministically for this render assertion.
    const overQuotaSeries = {
      ...gpuSeries,
      points: [...gpuSeries.points, { ts: "2026-07-31T00:00:00.000Z", value: 95 }],
    };

    renderWithProviders(
      <GpuQuotaCard slug={detail!.summary.slug} title={detail!.summary.title} series={overQuotaSeries} />,
    );

    expect(screen.getByText("Over quota")).toBeDefined();
  });
});
