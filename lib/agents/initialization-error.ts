/** Safe to return to an authenticated caller; never exposes paths or credentials. */
export class AgentInitializationError extends Error {
  constructor(cause?: unknown) {
    super("Agent runtime could not initialize. Check the deployed prompts and policies.", { cause });
    this.name = "AgentInitializationError";
  }
}
