/** Resolved deployment settings shared by selection, status and review budgets. */
export type AgentRuntime = "ai-sdk" | "agents-sdk";

export interface AgentRuntimeConfig {
  /** Whether a nonblank key is configured; the key itself never leaves this resolver. */
  readonly configured: boolean;
  readonly runtime: AgentRuntime;
  readonly adapter: "openai" | "mock";
  readonly generalModel: string;
  readonly reviewerModel: string;
  readonly chatModel: string;
  /** A deep flag alone cannot enable tools in the mock or AI SDK adapters. */
  readonly deepReviewEnabled: boolean;
}

export function resolveAgentRuntime(raw: string | undefined = process.env.JEEVES_AGENT_RUNTIME): AgentRuntime {
  return raw?.trim() === "agents-sdk" ? "agents-sdk" : "ai-sdk";
}

export function resolveAgentRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentRuntimeConfig {
  const configured = !!env.OPENAI_API_KEY?.trim();
  // Pass the fallback explicitly so a supplied env object stays independent
  // of process.env (the exported runtime selector also supports app callers).
  const runtime = resolveAgentRuntime(env.JEEVES_AGENT_RUNTIME ?? "ai-sdk");
  const generalModel = env.OPENAI_MODEL?.trim() || "gpt-5.1";
  return {
    configured,
    runtime,
    adapter: configured ? "openai" : "mock",
    generalModel,
    reviewerModel: runtime === "agents-sdk" ? env.OPENAI_TERRA_MODEL?.trim() || "gpt-5.6-terra" : generalModel,
    chatModel: runtime === "agents-sdk" ? env.OPENAI_LUNA_MODEL?.trim() || "gpt-5.6-luna" : generalModel,
    deepReviewEnabled: configured && runtime === "agents-sdk" && env.JEEVES_DEEP_REVIEW === "1",
  };
}

/** Deadlines for a draft run. Reservation sizes come from lib/agents/token-estimate.ts, from the built prompt. */
export function reviewInvocationLimits(runtime: AgentRuntimeConfig): { timeoutMs: number; attemptTimeoutMs: number } {
  return runtime.deepReviewEnabled
    ? { timeoutMs: 120_000, attemptTimeoutMs: 90_000 }
    : { timeoutMs: 60_000, attemptTimeoutMs: 45_000 };
}
