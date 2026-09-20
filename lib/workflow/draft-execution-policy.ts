/** Shared app-owned reservation policy. These are estimates, not measured provider spend. */
export interface DraftBudgetPolicy { day: string; dailyCap: number; tokensPerAttempt: number }
export function draftBudgetPolicy(now: Date = new Date()): DraftBudgetPolicy {
  const deep = process.env.JEEVES_AGENT_RUNTIME?.trim() === "agents-sdk" && process.env.JEEVES_DEEP_REVIEW === "1";
  return {day:now.toISOString().slice(0,10),dailyCap:500_000,tokensPerAttempt:deep?15_000:1_500};
}
