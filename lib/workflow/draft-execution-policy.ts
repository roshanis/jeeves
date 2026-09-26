/** Shared app-owned reservation policy. These are estimates, not measured provider spend. */
import { resolveAgentRuntimeConfig, reviewInvocationLimits } from "../agents/runtime";

export interface DraftBudgetPolicy { day: string; dailyCap: number; tokensPerAttempt: number }
export function draftBudgetPolicy(now: Date = new Date()): DraftBudgetPolicy {
  const { estimatedTokens } = reviewInvocationLimits(resolveAgentRuntimeConfig());
  return { day: now.toISOString().slice(0, 10), dailyCap: 500_000, tokensPerAttempt: estimatedTokens };
}
