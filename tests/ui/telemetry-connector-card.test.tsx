import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { TelemetryConnectorCard } from "@/components/jeeves/telemetry-connector-card";
import { telemetryConnectorStatus, syntheticTraces } from "@/lib/telemetry/connector";
import { renderWithProviders } from "./helpers";

describe("TelemetryConnectorCard", () => {
  it("renders the synthetic (not-configured) state with amber indicator and no external link", () => {
    const status = telemetryConnectorStatus();
    const traces = syntheticTraces("claims-ocr-coder");
    const { container } = renderWithProviders(
      <TelemetryConnectorCard status={status} traces={traces} />,
    );

    expect(screen.getByText("Synthetic telemetry (demo)")).toBeDefined();
    expect(container.querySelector('[data-slot="connector-synthetic-indicator"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="connector-configured-indicator"]')).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText("Synthetic data — demo")).toBeDefined();
    expect(screen.getByText("Synthetic OTel traces — demo")).toBeDefined();
  });

  it("renders the configured state with a green check indicator", () => {
    const originalEndpoint = process.env.PHOENIX_ENDPOINT;
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    try {
      const status = telemetryConnectorStatus();
      const traces = syntheticTraces("claims-ocr-coder");
      const { container } = renderWithProviders(
        <TelemetryConnectorCard status={status} traces={traces} />,
      );
      expect(container.querySelector('[data-slot="connector-configured-indicator"]')).not.toBeNull();
      expect(screen.getByText("Phoenix (Arize)")).toBeDefined();
    } finally {
      if (originalEndpoint === undefined) delete process.env.PHOENIX_ENDPOINT;
      else process.env.PHOENIX_ENDPOINT = originalEndpoint;
    }
  });

  it("renders all synthetic trace rows with span names and durations", () => {
    const status = telemetryConnectorStatus();
    const traces = syntheticTraces("claims-ocr-coder", 4);
    renderWithProviders(<TelemetryConnectorCard status={status} traces={traces} />);

    for (const t of traces) {
      expect(screen.getByText(t.traceId)).toBeDefined();
      expect(screen.getAllByText(t.span).length).toBeGreaterThan(0);
    }
  });
});
