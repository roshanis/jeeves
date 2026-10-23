import { AgentInitializationError, LlmNotConfiguredError } from "../agents/initialization-error";

/** Call only after the route's authentication, scope and input checks. */
export function agentInitializationResponse(error: unknown): Response | null {
  if (!(error instanceof AgentInitializationError)) return null;
  // Not a fault in the deployed prompts: this install has no LLM at all. A
  // fixed body, so nothing about the environment leaks to the caller.
  if (error instanceof LlmNotConfiguredError) {
    return Response.json({ error: "llm_not_configured", code: error.code }, { status: 503 });
  }
  return Response.json({
    error: error.message,
    code: "AGENT_INITIALIZATION_FAILED",
  }, { status: 503 });
}
