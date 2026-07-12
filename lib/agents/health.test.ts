import { afterEach, describe, expect, it, vi } from "vitest";
import { probeConnector } from "./health";

// Guarantee under test: with no key, probeConnector must NOT touch the
// network — so we mock `ai`'s generateText and assert it is never called.
const generateText = vi.fn(async () => ({ text: "ok" }));
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));
vi.mock("@ai-sdk/openai", () => ({ openai: (id: string) => ({ id }) }));

describe("probeConnector", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    generateText.mockClear();
  });

  it("reports the mock adapter and makes NO network call when no key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    const health = await probeConnector();
    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.adapter).toBe("mock");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("reports reachable + a latency when a key is set and the probe call succeeds", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const health = await probeConnector();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(true);
    expect(health.adapter).toBe("openai");
    expect(typeof health.latencyMs).toBe("number");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("reports configured-but-unreachable when the probe call throws", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    generateText.mockRejectedValueOnce(new Error("401 invalid api key"));
    const health = await probeConnector();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(false);
    expect(health.detail).toMatch(/invalid api key/i);
  });
});
