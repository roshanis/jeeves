/**
 * This is the ONLY place app code should call to get an `AgentPort`
 * (plan.md §4). Everything else — `app/`, `lib/` callers — must depend only
 * on the `AgentPort` type from `./ports`, never import `./openai-adapter`,
 * `./openai-agents-adapter`, or `./mock-adapter` directly.
 */
import { createMockAgentPort } from "./mock-adapter";
import { createOpenAIAgentPort } from "./openai-adapter";
import { createOpenAiAgentsAdapter } from "./openai-agents-adapter";
import type { AgentPort } from "./ports";

/**
 * Which real adapter to use when a key IS present. Two runtimes behind one
 * port is deliberate (plan.md §4): the port is the contract, the runtime is
 * an implementation detail app code never sees.
 *
 *  - "ai-sdk"     (default) Vercel AI SDK — one structured round trip per call.
 *  - "agents-sdk"           OpenAI Agents SDK — per-method Luna/Terra model
 *                           routing plus the opt-in deep-review tool loop
 *                           (`JEEVES_DEEP_REVIEW=1`).
 *
 * Anything unset or unrecognised resolves to "ai-sdk" — an unknown value must
 * never silently disable the LLM or crash a request; it degrades to the
 * previously-shipping runtime.
 */
export type AgentRuntime = "ai-sdk" | "agents-sdk";

export function resolveAgentRuntime(
  raw: string | undefined = process.env.JEEVES_AGENT_RUNTIME,
): AgentRuntime {
  return raw?.trim() === "agents-sdk" ? "agents-sdk" : "ai-sdk";
}

/**
 * Returns a real OpenAI-backed adapter when `OPENAI_API_KEY` is set and
 * non-empty, else the deterministic offline mock adapter (used in tests and
 * in any environment without a real key — plan.md §8: "LLM calls mocked").
 *
 * The keyless branch is unchanged and load-bearing: no API key means the mock
 * adapter regardless of `JEEVES_AGENT_RUNTIME`, so a provider outage — or a
 * public visitor — can never reach a paid runtime.
 */
export function getAgentPort(): AgentPort {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return resolveAgentRuntime() === "agents-sdk"
      ? createOpenAiAgentsAdapter()
      : createOpenAIAgentPort();
  }
  return createMockAgentPort();
}
