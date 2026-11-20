// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildAuditorPrompt, buildDraftReviewPrompt, buildIntakeInterviewPrompt, loadInstructions } from "./adapter-shared";
import {
  AUDITOR_OUTPUT_ESTIMATE_TOKENS,
  DEEP_REVIEW_MAX_TOOL_CALLS,
  DEEP_TOOL_RESULT_ESTIMATE_TOKENS,
  DRAFT_OUTPUT_ESTIMATE_TOKENS,
  INTAKE_OUTPUT_ESTIMATE_TOKENS,
  estimateAuditorTokens,
  estimateDraftAttemptTokens,
  estimateIntakeTokens,
  estimateTokens,
} from "./token-estimate";
import { WORKSPACE_DAILY_TOKEN_CAP } from "../security/budget";
import { DOMAIN_LABEL } from "../domain/labels";
import type { Domain } from "../domain/types";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";

const instructions = loadInstructions();
const draftInput = (answers: Record<string, unknown>, policy = readFileSync("docs/policies/legal.md", "utf8")) => ({
  reviewCycleId: "cycle-1",
  domain: "legal" as const,
  intake: { initiativeId: "i-1", intakeVersionId: "iv-1", answers },
  policyContext: [`Policy source: docs/policies/legal.md\n${policy}`],
});

describe("estimateTokens", () => {
  it("is one token per four characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcd", "efgh")).toBe(2);
  });
});

describe("estimateDraftAttemptTokens", () => {
  it("is the built prompt (system + user) over four plus the output allowance", () => {
    const input = draftInput({ useCase: "Synthetic test" });
    const { system, prompt } = buildDraftReviewPrompt(instructions, input);
    expect(estimateDraftAttemptTokens(input, false)).toBe(Math.ceil((system.length + prompt.length) / 4) + DRAFT_OUTPUT_ESTIMATE_TOKENS);
  });

  it("grows with the size of the prompt", () => {
    const small = estimateDraftAttemptTokens(draftInput({ useCase: "short" }), false);
    const large = estimateDraftAttemptTokens(draftInput({ useCase: "x".repeat(40_000) }), false);
    expect(large - small).toBeGreaterThanOrEqual(9_900);
  });

  it("puts a typical standard attempt well above the old flat 1,500 and inside a stated range", () => {
    // A real reviewer system prompt plus a real policy file: roughly 5-6k tokens before the output allowance.
    const estimate = estimateDraftAttemptTokens(draftInput({ useCase: "Synthetic test" }), false);
    expect(estimate).toBeGreaterThan(5_000);
    expect(estimate).toBeLessThan(20_000);
    // Four attempts fit in one workspace's share of the day; the share still bounds the total.
    expect(WORKSPACE_DAILY_TOKEN_CAP / estimate).toBeGreaterThan(2);
  });

  it("fits one full standard run of all eight domains for a typical intake in one workspace's share", () => {
    const answers = CHAMPION_PREFILL_PAYLOAD as unknown as Record<string, unknown>;
    const fullRun = (Object.keys(DOMAIN_LABEL) as Domain[]).reduce((sum, domain) => {
      const policy = readFileSync(`docs/policies/${domain}.md`, "utf8");
      const input = { ...draftInput(answers, policy), domain, policyContext: [`Policy source: docs/policies/${domain}.md\n${policy}`] };
      return sum + estimateDraftAttemptTokens(input, false);
    }, 0);
    expect(fullRun).toBeLessThanOrEqual(WORKSPACE_DAILY_TOKEN_CAP);
  });

  it("charges a deep run for each turn resending the prompt and the tool results so far", () => {
    const input = draftInput({ useCase: "Synthetic test" });
    const { system, prompt } = buildDraftReviewPrompt(instructions, input);
    const promptTokens = Math.ceil((system.length + prompt.length) / 4);
    const turns = DEEP_REVIEW_MAX_TOOL_CALLS + 1;
    const results = (DEEP_TOOL_RESULT_ESTIMATE_TOKENS * DEEP_REVIEW_MAX_TOOL_CALLS * turns) / 2;
    const deep = estimateDraftAttemptTokens(input, true);
    expect(deep).toBeGreaterThanOrEqual(turns * promptTokens + results);
    expect(deep).toBeGreaterThan(estimateDraftAttemptTokens(input, false) * 2);
  });
});

describe("chat estimates are sized from the built prompt", () => {
  it("intake counts its system prompt, the conversation and the payload", () => {
    const input = { conversation: [{ role: "user" as const, content: "hello" }], partialPayload: { a: "b" } };
    const { system, prompt } = buildIntakeInterviewPrompt(instructions, input);
    expect(estimateIntakeTokens(input)).toBe(Math.ceil((system.length + prompt.length) / 4) + INTAKE_OUTPUT_ESTIMATE_TOKENS);
    expect(estimateIntakeTokens(input)).toBeGreaterThan(Math.ceil(instructions.intake.length / 4));
  });

  it("auditor counts its system prompt, the question and the grounding rows", () => {
    const input = { question: "Which initiatives touch PHI?", groundingRows: [{ id: "r1", detail: "x".repeat(2000) }], queryUsed: "q" };
    const { system, prompt } = buildAuditorPrompt(instructions, input);
    expect(estimateAuditorTokens(input)).toBe(Math.ceil((system.length + prompt.length) / 4) + AUDITOR_OUTPUT_ESTIMATE_TOKENS);
  });
});
