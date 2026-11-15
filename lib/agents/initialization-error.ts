/** Safe to return to an authenticated caller; never exposes paths or credentials. */
export class AgentInitializationError extends Error {
  /** Stable wire code; subclasses with their own meaning override it. */
  readonly code: string = "AGENT_INITIALIZATION_FAILED";

  constructor(cause?: unknown, message = "Agent runtime could not initialize. Check the deployed prompts and policies.") {
    super(message, { cause });
    this.name = "AgentInitializationError";
  }
}

/**
 * This deployment has no LLM to call: a production install with no
 * OPENAI_API_KEY. Production never substitutes the deterministic mock (its
 * canned drafts look like real assessments), so the LLM routes answer 503
 * `llm_not_configured` instead.
 *
 * A subclass of AgentInitializationError on purpose: every place that already
 * releases a claim, skips a reservation or maps an initialization failure to a
 * 503 treats this the same way, and only the wire code and message differ.
 */
export class LlmNotConfiguredError extends AgentInitializationError {
  override readonly code: string = "LLM_NOT_CONFIGURED";

  constructor() {
    super(undefined, "No LLM is configured for this installation: set OPENAI_API_KEY.");
    this.name = "LlmNotConfiguredError";
  }
}
