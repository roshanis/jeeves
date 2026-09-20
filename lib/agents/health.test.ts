import { afterEach, describe, expect, it, vi } from "vitest";
import { probeConnector } from "./health";
import { getAgentPort } from "./index";

// Guarantee under test: with no key, probeConnector must NOT touch the
// network — so we mock `ai`'s generateText and assert it is never called.
const generateText = vi.fn(async (options: unknown) => { void options; return { text: "ok" }; });
vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: (options: unknown) => generateText(options),
}));
vi.mock("@ai-sdk/openai", () => ({ openai: (id: string) => ({ id }) }));
vi.mock("./index", async (importOriginal) => ({
  ...await importOriginal<typeof import("./index")>(),
  getAgentPort: vi.fn(),
}));

describe("probeConnector", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports the mock adapter and makes NO network call when no key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    const health = await probeConnector();
    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.adapter).toBe("mock");
    expect(generateText).not.toHaveBeenCalled();
    expect(getAgentPort).not.toHaveBeenCalled();
  });

  it("reports reachable + a latency when a key is set and the probe call succeeds", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const health = await probeConnector();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(true);
    expect(health.adapter).toBe("openai");
    expect(typeof health.latencyMs).toBe("number");
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(getAgentPort).toHaveBeenCalledTimes(1);
    expect(health.detail).not.toContain("will run live");
  });

  it("reports configured-but-unreachable when the probe call throws", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    generateText.mockRejectedValueOnce(new Error("401 invalid api key sk-private-test-value"));
    const health = await probeConnector();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(false);
    expect(health.detail).toMatch(/provider check failed/i);
    expect(health.detail).not.toContain("sk-private-test-value");
  });

  it("does not call the provider when the selected agent cannot initialize", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.mocked(getAgentPort).mockImplementationOnce(() => { throw new Error("ENOENT /private/build/prompts"); });
    const health = await probeConnector();
    expect(health.reachable).toBe(false);
    expect(health.detail).toMatch(/could not initialize/i);
    expect(health.detail).not.toContain("/private/build");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("probes the configured reviewer model for the selected Agents SDK runtime", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("OPENAI_MODEL", "unused-ai-sdk-model");
    vi.stubEnv("OPENAI_TERRA_MODEL", "configured-reviewer-model");
    const health = await probeConnector();
    expect(health.model).toBe("configured-reviewer-model");
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ model: { id: "configured-reviewer-model" } }));
    expect(health.detail).toMatch(/structured reviews.*not.*tested/i);
  });
});
