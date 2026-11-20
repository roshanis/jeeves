// @vitest-environment node
/**
 * Production never runs on the deterministic mock agent.
 *
 * Demo keeps its keyless mock default: it is how the public demo runs with
 * zero external calls. A production install without an OPENAI_API_KEY has no
 * LLM instead, and says so (a typed LlmNotConfiguredError the LLM routes map
 * to 503 `llm_not_configured`) rather than serving canned drafts that look
 * like real assessments.
 *
 * Every case sets JEEVES_MODE explicitly: unset means production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentInitializationResponse } from "../services/agent-error-response";
import { AgentInitializationError, LlmNotConfiguredError } from "./initialization-error";
import { assertLlmConfigured, getAgentPort } from "./index";
import { probeConnector } from "./health";
import { agentRuntimeStatus } from "./registry";
import { createMockAgentPort } from "./mock-adapter";
import { createOpenAIAgentPort } from "./openai-adapter";

const generateText = vi.fn(async (options: unknown): Promise<{ text: string }> => {
  void options;
  return { text: "ok" };
});
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (options: unknown) => generateText(options),
}));
vi.mock("@ai-sdk/openai", () => ({ openai: (id: string) => ({ id }) }));
vi.mock("./mock-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mock-adapter")>();
  return { ...original, createMockAgentPort: vi.fn(original.createMockAgentPort) };
});
vi.mock("./openai-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("./openai-adapter")>();
  return { ...original, createOpenAIAgentPort: vi.fn(original.createOpenAIAgentPort) };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function asProduction(key?: string): void {
  vi.stubEnv("JEEVES_MODE", undefined);
  vi.stubEnv("OPENAI_API_KEY", key);
}
function asDemo(key?: string): void {
  vi.stubEnv("JEEVES_MODE", "demo");
  vi.stubEnv("OPENAI_API_KEY", key);
}

describe("LlmNotConfiguredError", () => {
  it("is an agent initialization failure, so the existing cleanup and mapping paths treat it as one", () => {
    const error = new LlmNotConfiguredError();
    expect(error).toBeInstanceOf(AgentInitializationError);
    expect(error.name).toBe("LlmNotConfiguredError");
    expect(error.code).toBe("LLM_NOT_CONFIGURED");
    expect(new AgentInitializationError().code).toBe("AGENT_INITIALIZATION_FAILED");
  });

  it("names the missing setting but no value", () => {
    expect(new LlmNotConfiguredError().message).toMatch(/OPENAI_API_KEY/);
  });
});

describe("getAgentPort", () => {
  it.each([undefined, "", "   "])("in production with key %j throws LlmNotConfiguredError and never builds the mock", (key) => {
    asProduction(key);
    expect(() => getAgentPort()).toThrow(LlmNotConfiguredError);
    expect(createMockAgentPort).not.toHaveBeenCalled();
  });

  it("in production with a key builds the real adapter", () => {
    asProduction("sk-test-key");
    const port = getAgentPort();
    expect(createOpenAIAgentPort).toHaveBeenCalledTimes(1);
    expect(createMockAgentPort).not.toHaveBeenCalled();
    expect(port).toBeDefined();
  });

  it("treats a mistyped mode as production: 'Demo' gets no mock", () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    expect(() => getAgentPort()).toThrow(LlmNotConfiguredError);
  });

  it("in demo with no key keeps the keyless mock default", () => {
    asDemo(undefined);
    expect(() => getAgentPort()).not.toThrow();
    expect(createMockAgentPort).toHaveBeenCalledTimes(1);
    expect(createOpenAIAgentPort).not.toHaveBeenCalled();
  });

  it("in demo with a key builds the real adapter, as before", () => {
    asDemo("sk-test-key");
    getAgentPort();
    expect(createOpenAIAgentPort).toHaveBeenCalledTimes(1);
    expect(createMockAgentPort).not.toHaveBeenCalled();
  });
});

describe("assertLlmConfigured", () => {
  it("throws in production without a key and builds nothing", () => {
    asProduction(undefined);
    expect(() => assertLlmConfigured()).toThrow(LlmNotConfiguredError);
    expect(createMockAgentPort).not.toHaveBeenCalled();
    expect(createOpenAIAgentPort).not.toHaveBeenCalled();
  });

  it("returns in production with a key, without constructing an adapter", () => {
    asProduction("sk-test-key");
    expect(() => assertLlmConfigured()).not.toThrow();
    expect(createOpenAIAgentPort).not.toHaveBeenCalled();
  });

  it("returns in demo without a key", () => {
    asDemo(undefined);
    expect(() => assertLlmConfigured()).not.toThrow();
  });
});

describe("probeConnector", () => {
  it("in production without a key throws LlmNotConfiguredError and makes no provider call", async () => {
    asProduction(undefined);
    await expect(probeConnector()).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("in demo without a key still reports the mock adapter", async () => {
    asDemo(undefined);
    const health = await probeConnector();
    expect(health.adapter).toBe("mock");
    expect(health.configured).toBe(false);
    expect(health.detail).toMatch(/mock adapter/i);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("agentRuntimeStatus", () => {
  it("in production without a key says no LLM is configured, not that a mock is running", () => {
    asProduction(undefined);
    const status = agentRuntimeStatus();
    expect(status.adapter).toBe("none");
    expect(status.connected).toBe(false);
    expect(status.detail).toMatch(/no llm is configured/i);
    expect(status.detail).not.toMatch(/mock/i);
  });

  it("in demo without a key keeps the mock wording", () => {
    asDemo(undefined);
    const status = agentRuntimeStatus();
    expect(status.adapter).toBe("mock");
    expect(status.detail).toMatch(/mock adapter/i);
  });

  it("in production with a key reports OpenAI as configured", () => {
    asProduction("sk-test-key");
    const status = agentRuntimeStatus();
    expect(status.adapter).toBe("openai");
    expect(status.connected).toBe(true);
  });
});

describe("agentInitializationResponse", () => {
  it("maps LlmNotConfiguredError to a clean 503 llm_not_configured", async () => {
    const response = agentInitializationResponse(new LlmNotConfiguredError())!;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "llm_not_configured", code: "LLM_NOT_CONFIGURED" });
  });

  it("carries no configured value, path or cause", async () => {
    const body = JSON.stringify(await agentInitializationResponse(new LlmNotConfiguredError())!.json());
    expect(body).not.toMatch(/sk-|\/|ENOENT/);
  });

  it("keeps the existing initialization mapping for every other agent failure", async () => {
    const response = agentInitializationResponse(new AgentInitializationError(new Error("ENOENT /private/prompts")))!;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Agent runtime could not initialize. Check the deployed prompts and policies.",
      code: "AGENT_INITIALIZATION_FAILED",
    });
  });

  it("ignores errors that are not agent initialization failures", () => {
    expect(agentInitializationResponse(new Error("boom"))).toBeNull();
  });
});
