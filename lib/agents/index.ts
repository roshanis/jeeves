/**
 * This is the ONLY place app code should call to get an `AgentPort`
 * (plan.md §4). Everything else — `app/`, `lib/` callers — must depend only
 * on the `AgentPort` type from `./ports`, never import `./openai-adapter`
 * or `./mock-adapter` directly.
 */
import { createMockAgentPort } from "./mock-adapter";
import { createOpenAIAgentPort } from "./openai-adapter";
import type { AgentPort } from "./ports";

/**
 * Returns the real OpenAI-backed adapter when `OPENAI_API_KEY` is set and
 * non-empty, else the deterministic offline mock adapter (used in tests and
 * in any environment without a real key — plan.md §8: "LLM calls mocked").
 */
export function getAgentPort(): AgentPort {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return createOpenAIAgentPort();
  }
  return createMockAgentPort();
}
