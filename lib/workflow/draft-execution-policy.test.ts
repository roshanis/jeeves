// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_TOKEN_CAP, WORKSPACE_DAILY_TOKEN_CAP } from "../security/budget";
import { draftBudgetPolicy } from "./draft-execution-policy";

afterEach(() => vi.unstubAllEnvs());

import { estimateDraftAttemptTokens } from "../agents/token-estimate";

describe("resolved draft execution budget", () => {
  const input = {
    reviewCycleId: "cycle-1", domain: "legal" as const,
    intake: { initiativeId: "i", intakeVersionId: "iv", answers: { useCase: "Synthetic test" } },
    policyContext: ["Policy source: docs/policies/legal.md\nSynthetic policy text"],
  };

  it.each([
    ["test-placeholder", "ai-sdk", "1", false],
    ["test-placeholder", "unknown", "1", false],
    ["test-placeholder", "agents-sdk", "0", false],
    ["test-placeholder", " agents-sdk ", "1", true],
  ])("sizes an attempt from its built prompt for key=%s runtime=%s deep=%s", (key, runtime, deep, isDeep) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    const policy = draftBudgetPolicy(new Date("2026-09-20T05:00:00Z"));
    expect(policy).toMatchObject({ day: "2026-09-20", dailyCap: 500_000, workspaceCap: 50_000 });
    expect(policy?.estimateAttempt?.(input)).toBe(estimateDraftAttemptTokens(input, isDeep));
  });

  it("reserves more for a bigger prompt", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    const policy = draftBudgetPolicy();
    const bigger = { ...input, policyContext: ["x".repeat(40_000)] };
    expect(policy!.estimateAttempt!(bigger) - policy!.estimateAttempt!(input)).toBeGreaterThan(9_000);
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
