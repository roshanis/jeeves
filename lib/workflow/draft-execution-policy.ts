/** Shared app-owned reservation policy. These are estimates, not measured provider spend. */
import { DAILY_TOKEN_CAP, WORKSPACE_DAILY_TOKEN_CAP } from "../security/budget";
import { resolveAgentRuntimeConfig, reviewInvocationLimits } from "../agents/runtime";

export interface DraftBudgetPolicy { day: string; dailyCap: number; workspaceCap: number; tokensPerAttempt: number }

/**
 * The reservation for one draft attempt, or undefined when the offline mock
 * adapter will answer: no provider call means nothing to reserve.
 */
export function draftBudgetPolicy(now: Date = new Date()): DraftBudgetPolicy | undefined {
  const runtime = resolveAgentRuntimeConfig();
  if (runtime.adapter !== "openai") return undefined;
  const { estimatedTokens } = reviewInvocationLimits(runtime);
  return {
    day: now.toISOString().slice(0, 10),
    dailyCap: DAILY_TOKEN_CAP,
    workspaceCap: WORKSPACE_DAILY_TOKEN_CAP,
    tokensPerAttempt: estimatedTokens,
  };
}
