import { describe, expect, it, afterEach } from "vitest";
import { telemetryChecklistLine, telemetryConnectorStatus, syntheticTraces } from "./connector";

describe("telemetryConnectorStatus", () => {
  const originalEndpoint = process.env.PHOENIX_ENDPOINT;
  const originalProviderName = process.env.PHOENIX_PROVIDER_NAME;

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.PHOENIX_ENDPOINT;
    else process.env.PHOENIX_ENDPOINT = originalEndpoint;
    if (originalProviderName === undefined) delete process.env.PHOENIX_PROVIDER_NAME;
    else process.env.PHOENIX_PROVIDER_NAME = originalProviderName;
  });

  it("reports synthetic when PHOENIX_ENDPOINT is unset", () => {
    delete process.env.PHOENIX_ENDPOINT;
    delete process.env.PHOENIX_PROVIDER_NAME;

    const status = telemetryConnectorStatus();

    expect(status.state).toBe("synthetic");
    expect(status.provider).toBe("Synthetic telemetry (demo)");
    expect(status.detail).toContain("synthetic");
    expect(status.detail.toLowerCase()).toContain("never breaks the demo");
  });

  it("is amber 'endpoint set, not polled' for a valid http(s) URL: never configured, no sync time", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    delete process.env.PHOENIX_PROVIDER_NAME;

    const status = telemetryConnectorStatus();

    expect(status.state).toBe("endpoint_set");
    expect(status.provider).toBe("Phoenix (Arize)");
    expect(status.detail).toMatch(/not polled/i);
    expect(status.detail).not.toMatch(/configured|last sync/i);
    expect("lastSyncIso" in status).toBe(false);
  });

  it.each(["not a url", "phoenix.example.internal", "ftp://phoenix.example.internal", "https://"])(
    "says the endpoint is not a valid URL for %j",
    (value) => {
      process.env.PHOENIX_ENDPOINT = value;
      const status = telemetryConnectorStatus();
      expect(status.state).toBe("invalid_endpoint");
      expect(status.detail).toMatch(/not a valid URL/);
      expect(status.detail).not.toContain(value);
    },
  );

  it("uses PHOENIX_PROVIDER_NAME when set alongside a valid PHOENIX_ENDPOINT", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    process.env.PHOENIX_PROVIDER_NAME = "Acme Tracing";

    const status = telemetryConnectorStatus();

    expect(status.state).toBe("endpoint_set");
    expect(status.provider).toBe("Acme Tracing");
  });

  it("is deterministic across repeated calls (same env -> identical shape)", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    const a = telemetryConnectorStatus();
    const b = telemetryConnectorStatus();
    expect(a).toEqual(b);
  });
});

describe("telemetryChecklistLine (reset-demo)", () => {
  afterEach(() => {
    delete process.env.PHOENIX_ENDPOINT;
  });

  it("never reports a tick for PHOENIX_ENDPOINT: a warning that nothing contacts it", () => {
    process.env.PHOENIX_ENDPOINT = "https://phoenix.example.internal";
    const line = telemetryChecklistLine(telemetryConnectorStatus());
    expect(line.level).toBe("warn");
    expect(line.value).toMatch(/not polled/i);
  });

  it("warns about an invalid endpoint and about an unset one", () => {
    process.env.PHOENIX_ENDPOINT = "nope";
    expect(telemetryChecklistLine(telemetryConnectorStatus()).value).toMatch(/not a valid URL/);
    delete process.env.PHOENIX_ENDPOINT;
    expect(telemetryChecklistLine(telemetryConnectorStatus()).value).toMatch(/synthetic/i);
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
