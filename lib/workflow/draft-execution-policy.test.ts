// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_TOKEN_CAP, WORKSPACE_DAILY_TOKEN_CAP } from "../security/budget";
import { draftBudgetPolicy } from "./draft-execution-policy";

afterEach(() => vi.unstubAllEnvs());

describe("resolved draft execution budget", () => {
  it.each([
    ["test-placeholder", "ai-sdk", "1", 1500],
    ["test-placeholder", "unknown", "1", 1500],
    ["test-placeholder", "agents-sdk", "0", 1500],
    ["test-placeholder", " agents-sdk ", "1", 15_000],
  ])("reserves actual attempt capacity for key=%s runtime=%s deep=%s", (key, runtime, deep, tokensPerAttempt) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    expect(draftBudgetPolicy(new Date("2026-09-20T05:00:00Z"))).toEqual({
      day: "2026-09-20", dailyCap: 500_000, workspaceCap: 50_000, tokensPerAttempt,
    });
  });

  it.each(["", " \t "])("reserves nothing when no key is set (key=%j): the offline mock answers", (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    expect(draftBudgetPolicy(new Date("2026-09-20T05:00:00Z"))).toBeUndefined();
  });

  it("carries the per-workspace share next to the daily cap", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    expect(draftBudgetPolicy()?.workspaceCap).toBe(WORKSPACE_DAILY_TOKEN_CAP);
  });

  it("uses the same daily cap as the route guard", () => {
    expect(DAILY_TOKEN_CAP).toBe(500_000);
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    expect(draftBudgetPolicy()?.dailyCap).toBe(DAILY_TOKEN_CAP);
  });
});
