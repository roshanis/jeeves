// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeConnector } from "./health";
import { getAgentPort } from "./index";
import { agentRuntimeStatus } from "./registry";
import { createOpenAIAgentPort } from "./openai-adapter";
import { createOpenAiAgentsAdapterWithRunner } from "./openai-agents-adapter";

// Guarantee under test: with no key, probeConnector must NOT touch the
// network — so we mock `ai`'s generateText and assert it is never called.
const generateText = vi.fn(async (options: unknown): Promise<{ text: string; output?: unknown }> => { void options; return { text: "ok" }; });
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

  it.each(["", "   "])("reports mock without provider or asset calls for an empty key (%s)", async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
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
    expect(health).toMatchObject({ runtime: "agents-sdk", reviewerModel: "configured-reviewer-model", chatModel: "gpt-5.6-luna", deepReviewEnabled: false });
    expect(health.detail).toMatch(/AI SDK provider probe/i);
  });

  it.each([
    ["ai-sdk", "", "gpt-5.1", "gpt-5.1"],
    ["ai-sdk", " \t ", "gpt-5.1", "gpt-5.1"],
    ["ai-sdk", " custom-model ", "custom-model", "custom-model"],
    ["agents-sdk", "", "gpt-5.6-terra", "gpt-5.6-luna"],
    ["agents-sdk", " \t ", "gpt-5.6-terra", "gpt-5.6-luna"],
    ["agents-sdk", " custom-model ", "custom-model", "custom-model"],
  ])("aligns execution, probe and status for %s model override %s", async (runtime, override, reviewerModel, chatModel) => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", "0");
    for (const key of ["OPENAI_MODEL", "OPENAI_TERRA_MODEL", "OPENAI_LUNA_MODEL"]) vi.stubEnv(key, override);
    const reviewOutput = {
      assessmentMd: "Missing evidence for human review.", citations: [], evidenceRequests: [],
      recommendation: "return-with-gaps", suggestedConditions: [], confidenceNotes: "Review required.",
    };
    const capturedModels: unknown[] = [];
    const port = runtime === "ai-sdk" ? createOpenAIAgentPort() : createOpenAiAgentsAdapterWithRunner(async (agent) => {
      capturedModels.push(agent.model);
      return { finalOutput: agent.name === "jeeves-auditor"
        ? { answerMd: "No events supplied.", citedEvents: [], queryUsed: "test" }
        : reviewOutput };
    });
    generateText.mockResolvedValueOnce({ text: "", output: reviewOutput });
    const result = await port.draftReview({ reviewCycleId: "cycle", domain: "legal", intake: { initiativeId: "initiative", intakeVersionId: "intake", answers: {} } });
    expect(result.ok).toBe(true);
    if (runtime === "ai-sdk") {
      expect((generateText.mock.lastCall?.[0] as { model: { id: string } }).model.id).toBe(reviewerModel);
    } else {
      await port.auditorAnswer({ question: "What happened?", groundingRows: [], queryUsed: "test" });
      expect(capturedModels).toEqual([reviewerModel, chatModel]);
    }
    const health = await probeConnector();
    expect(generateText).toHaveBeenLastCalledWith(expect.objectContaining({ model: { id: reviewerModel } }));
    expect(health).toMatchObject({ model: reviewerModel, reviewerModel, chatModel });
    expect(agentRuntimeStatus()).toMatchObject({ model: reviewerModel, reviewerModel, chatModel });
  });
});
