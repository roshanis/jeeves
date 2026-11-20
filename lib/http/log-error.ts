import { redactDbError } from "../db/redact-error";

/**
 * Log an unexpected route error with a short request reference and return the
 * reference for the client. Name and message only, and driver errors are
 * redacted first (their messages quote bound parameters). Never pass bodies,
 * prompts or evidence content here.
 */
export function logUnexpectedError(label: string, error: unknown): string {
  const requestId = crypto.randomUUID();
  const safe = redactDbError(error);
  console.error(label, {
    requestId,
    errorName: safe.name,
    errorMessage: safe.message.replace(/\s*[\r\n]+\s*/g, " ").slice(0, 300),
  });
  return requestId;
}
