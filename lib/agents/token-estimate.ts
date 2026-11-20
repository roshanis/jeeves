/**
 * Token estimates that size the daily-budget reservations. They are estimates,
 * not measured provider usage: one token per four characters of the prompt that
 * is actually built and sent, plus an allowance for the reply. Nothing is
 * adjusted after the call returns.
 */
import {
  buildAuditorPrompt,
  buildDraftReviewPrompt,
  buildIntakeInterviewPrompt,
  loadInstructions,
} from "./adapter-shared";
import type { AuditorAnswerInput, DraftReviewInput, IntakeInterviewInput } from "./ports";

export const CHARS_PER_TOKEN = 4;

/** Allowances for the reply; reasoning models also spend tokens here, so they are not tight. */
export const DRAFT_OUTPUT_ESTIMATE_TOKENS = 2_500;
export const AUDITOR_OUTPUT_ESTIMATE_TOKENS = 1_500;
export const INTAKE_OUTPUT_ESTIMATE_TOKENS = 1_000;

/**
 * Deep review caps (they bound real spend as well as the estimate). Each tool
 * call needs its own turn and the final answer one more, so a run is at most
 * calls + 1 model turns. Policy files are about 3-8 KB, so one tool result is
 * estimated at 2,000 tokens and read results are cut to match.
 */
export const DEEP_REVIEW_MAX_TOOL_CALLS = 3;
export const DEEP_REVIEW_MAX_TURNS = DEEP_REVIEW_MAX_TOOL_CALLS + 2;
export const DEEP_TOOL_RESULT_ESTIMATE_TOKENS = 2_000;
export const DEEP_TOOL_RESULT_MAX_CHARS = DEEP_TOOL_RESULT_ESTIMATE_TOKENS * CHARS_PER_TOKEN;

// The instruction files do not change while the server runs; read them once.
let instructions: ReturnType<typeof loadInstructions> | undefined;
const cachedInstructions = () => (instructions ??= loadInstructions());

export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / CHARS_PER_TOKEN);
}

/** One reviewer attempt. A deep run resends the prompt and the tool results gathered so far on every turn. */
export function estimateDraftAttemptTokens(input: DraftReviewInput, deep: boolean): number {
  const { system, prompt } = buildDraftReviewPrompt(cachedInstructions(), input);
  const promptTokens = estimateTokens(system, prompt);
  if (!deep) return promptTokens + DRAFT_OUTPUT_ESTIMATE_TOKENS;
  const turns = DEEP_REVIEW_MAX_TOOL_CALLS + 1;
  const resentResults = (DEEP_TOOL_RESULT_ESTIMATE_TOKENS * DEEP_REVIEW_MAX_TOOL_CALLS * turns) / 2;
  return turns * promptTokens + resentResults + DRAFT_OUTPUT_ESTIMATE_TOKENS;
}

export function estimateIntakeTokens(input: IntakeInterviewInput): number {
  const { system, prompt } = buildIntakeInterviewPrompt(cachedInstructions(), input);
  return estimateTokens(system, prompt) + INTAKE_OUTPUT_ESTIMATE_TOKENS;
}

export function estimateAuditorTokens(input: AuditorAnswerInput): number {
  const { system, prompt } = buildAuditorPrompt(cachedInstructions(), input);
  return estimateTokens(system, prompt) + AUDITOR_OUTPUT_ESTIMATE_TOKENS;
}
