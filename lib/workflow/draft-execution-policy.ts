/** Shared app-owned reservation policy. These are estimates, not measured provider spend. */
import { DAILY_TOKEN_CAP, WORKSPACE_DAILY_TOKEN_CAP } from "../security/budget";
import { resolveAgentRuntimeConfig } from "../agents/runtime";
import type { DraftReviewInput } from "../agents/ports";
import { DRAFT_OUTPUT_ESTIMATE_TOKENS, estimateDraftAttemptTokens } from "../agents/token-estimate";

export interface DraftBudgetPolicy {
  day: string;
  dailyCap: number;
  workspaceCap: number;
  /** Reserved when `estimateAttempt` is absent. */
  tokensPerAttempt: number;
  /** Sizes one attempt from the prompt that will be sent, so a bigger context reserves more. */
  estimateAttempt?: (input: DraftReviewInput) => number;
}

/**
 * The reservation for one draft attempt, or undefined when the offline mock
 * adapter will answer: no provider call means nothing to reserve.
 */
export function draftBudgetPolicy(now: Date = new Date()): DraftBudgetPolicy | undefined {
  const runtime = resolveAgentRuntimeConfig();
  if (runtime.adapter !== "openai") return undefined;
  return {
    day: now.toISOString().slice(0, 10),
    dailyCap: DAILY_TOKEN_CAP,
    workspaceCap: WORKSPACE_DAILY_TOKEN_CAP,
    tokensPerAttempt: DRAFT_OUTPUT_ESTIMATE_TOKENS,
    estimateAttempt: (input) => estimateDraftAttemptTokens(input, runtime.deepReviewEnabled),
  };
}
