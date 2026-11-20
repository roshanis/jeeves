import { assertLlmConfigured } from "../agents";
import { AgentInitializationError, LlmNotConfiguredError } from "../agents/initialization-error";

/**
 * Whether this install has no LLM at all (production without a key; demo always
 * has the keyless mock). Safe to ask BEFORE authentication: the answer is only
 * ever used to skip a token reservation, never sent to the caller.
 */
export function llmNotConfigured(): boolean {
  try {
    assertLlmConfigured();
    return false;
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) return true;
    throw error;
  }
}

/**
 * Not a fault in the deployed prompts: this install has no LLM at all. A fixed
 * body, so nothing about the environment leaks to the caller. Call only after
 * the route's authentication, scope and input checks.
 */
export function llmNotConfiguredResponse(error: LlmNotConfiguredError = new LlmNotConfiguredError()): Response {
  return Response.json({ error: "llm_not_configured", code: error.code }, { status: 503 });
}

/** Call only after the route's authentication, scope and input checks. */
export function agentInitializationResponse(error: unknown): Response | null {
  if (!(error instanceof AgentInitializationError)) return null;
  if (error instanceof LlmNotConfiguredError) return llmNotConfiguredResponse(error);
  return Response.json({
    error: error.message,
    code: "AGENT_INITIALIZATION_FAILED",
  }, { status: 503 });
}
