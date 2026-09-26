// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAgentRuntimeConfig } from "./runtime";

describe("resolved agent runtime", () => {
  it.each([
    [undefined, "agents-sdk", "1", false, "agents-sdk", false],
    ["   ", "agents-sdk", "1", false, "agents-sdk", false],
    ["test-placeholder", undefined, "1", true, "ai-sdk", false],
    ["test-placeholder", "unknown", "1", true, "ai-sdk", false],
    ["test-placeholder", "ai-sdk", "1", true, "ai-sdk", false],
    ["test-placeholder", "agents-sdk", undefined, true, "agents-sdk", false],
    ["test-placeholder", " agents-sdk ", "1", true, "agents-sdk", true],
  ])("resolves key=%s, runtime=%s, deep=%s", (key, rawRuntime, deep, configured, runtime, deepReviewEnabled) => {
    const result = resolveAgentRuntimeConfig({
      OPENAI_API_KEY: key,
      JEEVES_AGENT_RUNTIME: rawRuntime,
      JEEVES_DEEP_REVIEW: deep,
    });
    expect(result).toMatchObject({ configured, runtime, deepReviewEnabled, adapter: configured ? "openai" : "mock" });
    expect(JSON.stringify(result)).not.toContain("test-placeholder");
  });

  it("uses the general model for every AI SDK capability", () => {
    expect(resolveAgentRuntimeConfig({ OPENAI_MODEL: "general", OPENAI_TERRA_MODEL: "review", OPENAI_LUNA_MODEL: "chat" }))
      .toMatchObject({ generalModel: "general", reviewerModel: "general", chatModel: "general" });
  });

  it("resolves the separate Agents SDK reviewer and chat model ids", () => {
    expect(resolveAgentRuntimeConfig({ JEEVES_AGENT_RUNTIME: "agents-sdk", OPENAI_MODEL: "general", OPENAI_TERRA_MODEL: "review", OPENAI_LUNA_MODEL: "chat" }))
      .toMatchObject({ generalModel: "general", reviewerModel: "review", chatModel: "chat" });
    expect(resolveAgentRuntimeConfig({ JEEVES_AGENT_RUNTIME: "agents-sdk" }))
      .toMatchObject({ generalModel: "gpt-5.1", reviewerModel: "gpt-5.6-terra", chatModel: "gpt-5.6-luna" });
  });

  it.each(["", " \t "])("uses application model defaults for blank overrides (%s)", (override) => {
    const env = { OPENAI_MODEL: override, OPENAI_TERRA_MODEL: override, OPENAI_LUNA_MODEL: override };
    expect(resolveAgentRuntimeConfig({ ...env, JEEVES_AGENT_RUNTIME: "ai-sdk" }))
      .toMatchObject({ generalModel: "gpt-5.1", reviewerModel: "gpt-5.1", chatModel: "gpt-5.1" });
    expect(resolveAgentRuntimeConfig({ ...env, JEEVES_AGENT_RUNTIME: "agents-sdk" }))
      .toMatchObject({ generalModel: "gpt-5.1", reviewerModel: "gpt-5.6-terra", chatModel: "gpt-5.6-luna" });
  });

  it("trims configured model identifiers", () => {
    expect(resolveAgentRuntimeConfig({ JEEVES_AGENT_RUNTIME: "agents-sdk", OPENAI_MODEL: " general ", OPENAI_TERRA_MODEL: " review ", OPENAI_LUNA_MODEL: " chat " }))
      .toMatchObject({ generalModel: "general", reviewerModel: "review", chatModel: "chat" });
  });
});
