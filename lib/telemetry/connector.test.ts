import { describe, expect, it, afterEach } from "vitest";
import { telemetryConnectorStatus, syntheticTraces } from "./connector";

describe("telemetryConnectorStatus", () => {
  const originalEndpoint = process.env.PHOENIX_ENDPOINT;
  const originalProviderName = process.env.PHOENIX_PROVIDER_NAME;

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.PHOENIX_ENDPOINT;
    else process.env.PHOENIX_ENDPOINT = originalEndpoint;
    if (originalProviderName === undefined) delete process.env.PHOENIX_PROVIDER_NAME;
    else process.env.PHOENIX_PROVIDER_NAME = originalProviderName;
  });

  it("reports not-configured/synthetic when PHOENIX_ENDPOINT is unset", () => {
    delete process.env.PHOENIX_ENDPOINT;
    delete process.env.PHOENIX_PROVIDER_NAME;

    const status = telemetryConnectorStatus();

    expect(status.configured).toBe(false);
    expect(status.provider).toBe("Synthetic telemetry (demo)");
    expect(status.lastSyncIso).toBeNull();
    expect(status.detail).toContain("synthetic");
    expect(status.detail.toLowerCase()).toContain("never breaks the demo");
  });

  it("reports configured with a deterministic lastSync when PHOENIX_ENDPOINT is set", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    delete process.env.PHOENIX_PROVIDER_NAME;

    const status = telemetryConnectorStatus();

    expect(status.configured).toBe(true);
    expect(status.provider).toBe("Phoenix (Arize)");
    expect(status.lastSyncIso).toBe("2026-07-01T06:00:00.000Z");
    expect(status.detail).toContain("Connector failure never breaks the demo");
  });

  it("uses PHOENIX_PROVIDER_NAME when set alongside PHOENIX_ENDPOINT", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    process.env.PHOENIX_PROVIDER_NAME = "Acme Tracing";

    const status = telemetryConnectorStatus();

    expect(status.configured).toBe(true);
    expect(status.provider).toBe("Acme Tracing");
  });

  it("is deterministic across repeated calls (same env -> identical shape)", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    const a = telemetryConnectorStatus();
    const b = telemetryConnectorStatus();
    expect(a).toEqual(b);
  });
});

describe("syntheticTraces", () => {
  it("returns 5 rows by default, each with a traceId, span, and positive duration", () => {
    const rows = syntheticTraces("claims-ocr-coder");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(typeof row.span).toBe("string");
      expect(row.span.length).toBeGreaterThan(0);
      expect(row.durationMs).toBeGreaterThan(0);
    }
  });

  it("respects a custom count", () => {
    expect(syntheticTraces("claims-ocr-coder", 3)).toHaveLength(3);
  });

  it("is deterministic for the same slug (no Math.random/Date.now drift)", () => {
    const a = syntheticTraces("member-chat-copilot");
    const b = syntheticTraces("member-chat-copilot");
    expect(a).toEqual(b);
  });

  it("produces different trace ids for different slugs", () => {
    const a = syntheticTraces("member-chat-copilot");
    const b = syntheticTraces("claims-ocr-coder");
    expect(a.map((r) => r.traceId)).not.toEqual(b.map((r) => r.traceId));
  });
});
