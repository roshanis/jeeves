import { AgentInitializationError } from "../agents/initialization-error";

/** Call only after the route's authentication, scope and input checks. */
export function agentInitializationResponse(error: unknown): Response | null {
  if (!(error instanceof AgentInitializationError)) return null;
  return Response.json({
    error: error.message,
    code: "AGENT_INITIALIZATION_FAILED",
  }, { status: 503 });
}
