/** Prompt loading/building, input checks, and provider-neutral error mapping. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  AuditorAnswerInput,
  DraftReviewInput,
  GovernanceDomain,
  IntakeInterviewInput,
  PortFailure,
} from "./ports";

/* -------------------------------------------------------------------------
 * Instruction files for one adapter instance
 * ---------------------------------------------------------------------- */

export const KNOWN_DOMAINS: readonly GovernanceDomain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

export function isGovernanceDomain(value: unknown): value is GovernanceDomain {
  return (
    typeof value === "string" &&
    (KNOWN_DOMAINS as readonly string[]).includes(value)
  );
}

export function repoAgentsDir(): string {
  return path.join(process.cwd(), "agents");
}

export function readAgentFile(...segments: string[]): string {
  return readFileSync(path.join(repoAgentsDir(), ...segments), "utf-8");
}

export interface CachedInstructions {
  readonly reviewerShared: string;
  readonly reviewerTracks: ReadonlyMap<GovernanceDomain, string>;
  /** agents/auditor/instructions.md — natural-language audit Q&A (M2). */
  readonly auditor: string;
  /** agents/intake/instructions.md — conversational intake interview (M2). */
  readonly intake: string;
}

export const TRACK_FILENAMES: Record<GovernanceDomain, string> = {
  legal: "legal.md",
  procurement: "procurement.md",
  "tech-architecture": "tech-architecture.md",
  "responsible-ai": "responsible-ai.md",
  security: "security.md",
  "privacy-hipaa": "privacy-hipaa.md",
  "clinical-safety": "clinical-safety.md",
  "data-governance": "data-governance.md",
};

export function loadInstructions(): CachedInstructions {
  const reviewerShared = readAgentFile("reviewer", "instructions.md");
  const reviewerTracks = new Map<GovernanceDomain, string>();
  for (const domain of KNOWN_DOMAINS) {
    reviewerTracks.set(
      domain,
      readAgentFile("reviewer", "tracks", TRACK_FILENAMES[domain]),
    );
  }
  const auditor = readAgentFile("auditor", "instructions.md");
  const intake = readAgentFile("intake", "instructions.md");

  return {
    reviewerShared,
    reviewerTracks,
    auditor,
    intake,
  };
}

/* -------------------------------------------------------------------------
 * Error mapping (provider-agnostic slice)
 * ---------------------------------------------------------------------- */

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

/**
 * A Zod schema-validation failure on the MODEL's returned output (i.e. the
 * provider call succeeded, but the object it produced does not conform to
 * our schema) is deliberately mapped to `kind: "provider", retryable: false`
 * — NOT `kind: "validation"`.
 *
 * Rationale (per ports.ts's own doc comment on `PortFailure`): `"validation"`
 * is documented as "Input rejected before any provider call" — i.e. pre-call
 * validation of what WE sent (schema/length caps on our own input). A
 * post-call schema mismatch is not that: a provider call was made, and the
 * provider (the model) failed to produce conformant structured output. That
 * is a provider failure, and it is not safely retryable in general (the same
 * prompt is likely to produce the same malformed shape again without a
 * change to the prompt or schema), so `retryable: false`.
 */
export function mapModelOutputSchemaFailure(zodError: z.ZodError): PortFailure {
  return {
    kind: "provider",
    message: `Model output failed schema validation: ${zodError.message}`,
    retryable: false,
  };
}

/**
 * PortFailure mapping CONTRACT: each adapter owns its own provider-error-type
 * mapping (e.g. `openai-adapter.ts`'s `mapCallErrorToPortFailure`, which
 * switches on AI-SDK-specific `APICallError`) — that mapping is NOT
 * provider-agnostic and does not live here. What IS provider-agnostic, and
 * therefore lives here, is the SHAPE every adapter must produce and the
 * retryable/non-retryable split those shapes encode. The constructors
 * below are the shared builders for those shapes so two adapters can
 * never drift into emitting subtly different `PortFailure` objects for the
 * same conceptual failure.
 */
export function providerFailure(
  message: string,
  retryable: boolean,
): PortFailure {
  return { kind: "provider", message, retryable };
}

export function cancelledFailure(reason?: string): PortFailure {
  return reason === undefined
    ? { kind: "cancelled" }
    : { kind: "cancelled", reason };
}

/* -------------------------------------------------------------------------
 * Input validation (pre-call, kind: "validation")
 * ---------------------------------------------------------------------- */

export function validateDraftReviewInput(
  input: DraftReviewInput,
): PortFailure | null {
  const issues: string[] = [];
  if (!input.reviewCycleId || input.reviewCycleId.trim().length === 0) {
    issues.push("reviewCycleId");
  }
  if (!isGovernanceDomain(input.domain)) {
    issues.push("domain");
  }
  if (issues.length > 0) {
    return {
      kind: "validation",
      message: "draftReview input failed pre-call validation.",
      issues,
    };
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Temperature
 *
 * 0.1 chosen (not 0.2): agents/README.md calls for "low temperature
 * (deterministic-leaning)" specifically to keep citations and structured
 * fields stable across repeated runs on the same input (demo repeatability
 * + test-fixture stability). 0.1 is the more conservative of the two
 * suggested values and these are grounded drafting/extraction tasks, not
 * anything benefiting from creative variance.
 * ---------------------------------------------------------------------- */
export const TEMPERATURE = 0.1;

export function buildDraftReviewPrompt(
  instructions: CachedInstructions,
  input: DraftReviewInput,
): { system: string; prompt: string } {
  const trackOverlay = instructions.reviewerTracks.get(input.domain);
  const system = trackOverlay
    ? `${instructions.reviewerShared}\n\n---\n\n${trackOverlay}`
    : instructions.reviewerShared;

  const prompt = JSON.stringify({
    reviewCycleId: input.reviewCycleId,
    domain: input.domain,
    intake: input.intake,
    policyContext: input.policyContext ?? [],
  });

  return { system, prompt };
}

export function buildAuditorPrompt(
  instructions: CachedInstructions,
  input: AuditorAnswerInput,
): { system: string; prompt: string } {
  // No rich-to-port mapping step here (unlike draftReview): per
  // agents/auditor/instructions.md, the model's AuditorAnswerOutput IS
  // the port shape verbatim (see lib/agents/schemas.ts's doc comment on
  // auditorAnswerOutputSchema). The user prompt is exactly the question,
  // the already-fetched grounding rows, and which query produced them —
  // the model never chooses or runs a query itself (instructions.md
  // "What you will receive").
  const prompt = JSON.stringify({
    question: input.question,
    groundingRows: input.groundingRows,
    queryUsed: input.queryUsed,
  });

  return { system: instructions.auditor, prompt };
}

export function buildIntakeInterviewPrompt(
  instructions: CachedInstructions,
  input: IntakeInterviewInput,
): { system: string; prompt: string } {
  // Same no-mapping relationship as auditorAnswer above: the model's
  // IntakeInterviewOutput (agents/intake/instructions.md) IS the port
  // shape verbatim. The user prompt is the conversation so far and the
  // current partial payload — the model continues from there, per
  // instructions.md's "What you will receive."
  const prompt = JSON.stringify({
    conversation: input.conversation,
    partialPayload: input.partialPayload,
  });

  return { system: instructions.intake, prompt };
}
