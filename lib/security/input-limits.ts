/**
 * Input size/shape validation for public-demo mutation endpoints (plan §3 /
 * AGENTS.md hard rule 2: "input length caps").
 *
 * IMPORTANT scope note: this module enforces *size and shape only* — per-
 * field character caps, a total payload cap, and control-character
 * stripping. It deliberately does NOT censor or pattern-match on content
 * (no keyword/prompt-injection-phrase blocking here). Defending against
 * prompt injection is the agents' job via input-as-data discipline (treat
 * all user-supplied text as inert data passed to the model, never as
 * instructions the surrounding system executes) — see agents/ layer. This
 * module's only job is to keep payloads small and free of control
 * characters before they ever reach that layer.
 */

export interface FieldLimit {
  field: string;
  maxChars: number;
}

export type InputGapReason = "field_too_long" | "payload_too_large" | "unknown_field";

export interface InputGap {
  field: string;
  reason: InputGapReason;
  limit: number;
  actual: number;
}

export interface InputValidationResult {
  ok: boolean;
  gaps: InputGap[];
  /** Field values with control characters stripped (whitespace preserved). */
  sanitized: Record<string, string>;
}

/**
 * Strip C0/C1 control characters (e.g. NUL, bell, escape) while preserving
 * normal whitespace: space (0x20), tab (0x09), newline (0x0A), carriage
 * return (0x0D). Anything in the 0x00–0x1F or 0x7F–0x9F ranges other than
 * those is removed.
 */
function stripControlCharacters(value: string): string {
  let result = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isAllowedWhitespace = ch === "\t" || ch === "\n" || ch === "\r";
    const isControl = (code <= 0x1f && !isAllowedWhitespace) || (code >= 0x7f && code <= 0x9f);
    if (!isControl) {
      result += ch;
    }
  }
  return result;
}

/**
 * Validate a field/value record against declared per-field caps and a
 * total payload cap. Collects every violation (does not short-circuit on
 * the first) so callers can present a complete gap list to the user.
 *
 * Sanitization (control-character stripping) happens first, and all
 * length checks are performed against the sanitized value — a field that
 * is only over-length because of control-character padding will pass once
 * sanitized.
 */
export function validateInputSize(
  fields: Record<string, string>,
  limits: FieldLimit[],
  totalPayloadCap: number,
): InputValidationResult {
  const limitByField = new Map(limits.map((l) => [l.field, l]));
  const gaps: InputGap[] = [];
  const sanitized: Record<string, string> = {};

  let totalLength = 0;

  for (const [field, rawValue] of Object.entries(fields)) {
    const cleanValue = stripControlCharacters(rawValue);
    sanitized[field] = cleanValue;
    totalLength += cleanValue.length;

    const limit = limitByField.get(field);
    if (!limit) {
      gaps.push({ field, reason: "unknown_field", limit: 0, actual: cleanValue.length });
      continue;
    }
    if (cleanValue.length > limit.maxChars) {
      gaps.push({
        field,
        reason: "field_too_long",
        limit: limit.maxChars,
        actual: cleanValue.length,
      });
    }
  }

  if (totalLength > totalPayloadCap) {
    gaps.push({
      field: "__total__",
      reason: "payload_too_large",
      limit: totalPayloadCap,
      actual: totalLength,
    });
  }

  return { ok: gaps.length === 0, gaps, sanitized };
}
