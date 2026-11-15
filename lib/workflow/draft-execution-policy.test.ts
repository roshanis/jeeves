// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_TOKEN_CAP } from "../security/budget";
import { draftBudgetPolicy } from "./draft-execution-policy";

afterEach(() => vi.unstubAllEnvs());

describe("resolved draft execution budget", () => {
  it.each([
    ["", "agents-sdk", "1", 1500],
    [" \t ", "agents-sdk", "1", 1500],
    ["test-placeholder", "ai-sdk", "1", 1500],
    ["test-placeholder", "unknown", "1", 1500],
    ["test-placeholder", "agents-sdk", "0", 1500],
    ["test-placeholder", " agents-sdk ", "1", 15_000],
  ])("reserves actual attempt capacity for key=%s runtime=%s deep=%s", (key, runtime, deep, tokensPerAttempt) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    expect(draftBudgetPolicy(new Date("2026-09-20T05:00:00Z"))).toEqual({
      day: "2026-09-20", dailyCap: 500_000, tokensPerAttempt,
    });
  });

  it("uses the same daily cap as the route guard", () => {
    expect(DAILY_TOKEN_CAP).toBe(500_000);
    expect(draftBudgetPolicy().dailyCap).toBe(DAILY_TOKEN_CAP);
  });
});
