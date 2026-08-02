/**
 * Provider-agnostic pieces shared by every `AgentPort` adapter (currently
 * `lib/agents/openai-adapter.ts`; the OpenAI Agents SDK adapter to follow
 * reuses this module verbatim rather than re-deriving it).
 *
 * What lives here: instruction-file loading/caching, the deterministic
 * tier/domain helpers, pre-call input validation, the five per-port-method
 * prompt builders (so both adapters build byte-identical `system`/`prompt`
 * strings), and the provider-agnostic slice of the `PortFailure` mapping
 * contract. What does NOT live here: anything that depends on a specific
 * provider SDK's error types or call shape (e.g. `callStructured` and
 * `mapCallErrorToPortFailure`, which are AI-SDK-specific and stay in
 * `openai-adapter.ts`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import type {
  AuditorAnswerInput,
  CompletenessCheckInput,
  DraftReviewInput,
  GovernanceDomain,
  IntakeInterviewInput,
  PortFailure,
  RiskTier,
  TriageAssistInput,
} from "./ports";

/* -------------------------------------------------------------------------
 * Instruction-file loading (constructed once, cached in memory)
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

export const RISK_TIERS: readonly RiskTier[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/**
 * Deterministic-tier stopgap (documented judgment call): ports.ts's
 * `TriageAssistInput` is just `{ intake }` — it has no explicit
 * already-computed-tier field yet, but agents/triage/instructions.md is
 * explicit that the tier is an INPUT to the agent ("computed by deterministic
 * code, never by you"). Until intake/tier plumbing lands on the port, we read
 * the already-computed tier from the intake answers under the documented
 * convention key `answers["tier"]` (falling back to `answers["suggestedTier"]`),
 * defaulting to "medium" when neither is present.
 * TODO M2: replace with an explicit computed-tier field once the intake
 * schema / tier plumbing lands.
 */
export function tierFromAnswers(
  answers: Readonly<Record<string, unknown>>,
): RiskTier {
  const candidate = answers["tier"] ?? answers["suggestedTier"];
  return typeof candidate === "string" &&
    (RISK_TIERS as readonly string[]).includes(candidate)
    ? (candidate as RiskTier)
    : "medium";
}

/**
 * Resolves the repo-root `agents/` directory relative to *this module's own
 * file location* (`import.meta.url` -> `fileURLToPath` -> `dirname`), rather
 * than `process.cwd()`.
 *
 * Empirically verified while writing this adapter's tests: `vitest run`
 * from the repo root does set `process.cwd()` to the repo root, so
 * `path.join(process.cwd(), "agents", ...)` *would* have worked for the
 * `npm test` path. But `process.cwd()` is a property of the process that
 * invokes the test runner, not of this module — any future caller that
 * imports this adapter from a different working directory (a script run
 * from a subdirectory, a bundled serverless function, etc.) would silently
 * resolve the wrong path. Resolving from `import.meta.url` instead ties the
 * path to this file's fixed position in the repo (`lib/agents/` ->
 * `../../agents/`), which is invariant under the caller's cwd. This module
 * lives at `<repo-root>/lib/agents/openai-adapter.ts`, so `../../agents` is
 * exactly `<repo-root>/agents`.
 *
 * Moved here verbatim from `lib/agents/openai-adapter.ts` (pure refactor,
 * see agents/README.md "adapter-shared" note): this function still lives at
 * `<repo-root>/lib/agents/adapter-shared.ts` — same directory as before, just
 * a different filename in it — so `import.meta.url`'s directory component is
 * unchanged and `../../agents` still resolves to exactly `<repo-root>/agents`.
 * Verified by inspection (no other file in `lib/agents/` moved) rather than
 * relying on any behavior change, since this refactor changes zero behavior.
 */
export function repoAgentsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  return path.join(thisDir, "..", "..", "agents");
}

export function readAgentFile(...segments: string[]): string {
  return readFileSync(path.join(repoAgentsDir(), ...segments), "utf-8");
}

export interface CachedInstructions {
  readonly reviewerShared: string;
  readonly reviewerTracks: ReadonlyMap<GovernanceDomain, string>;
  readonly triage: string;
  /**
   * checkCompleteness has no dedicated agents/<name>/instructions.md in this
   * repo (judgment call, documented here and at the call site below): there
   * is no `agents/completeness/` directory as of this task. Rather than
   * blocking AgentPort.checkCompleteness on a doc that doesn't exist yet, we
   * use a minimal, pragmatic inline system prompt that follows the same
   * "never approve, only flag gaps" rule (AGENTS.md rule 1) as every other
   * agent in this corpus. This is pending a dedicated agents/completeness/
   * instructions.md — TODO M2 (tracked alongside the other deferred
   * agent schemas noted in lib/agents/schemas.ts).
   */
  readonly completeness: string;
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

export const COMPLETENESS_FALLBACK_SYSTEM_PROMPT = `You are an intake-completeness checking assistant for Jeeves, the AI \
governance gateway used internally at Meridian Health, a fictional healthcare \
payer. You never approve or reject an initiative — you only flag intake \
fields that are missing or insufficient for a human requester to address \
(AGENTS.md rule 1). Given the submitted intake answers, return exactly the \
structured object requested: whether the intake is complete, which fields \
are missing or insufficient (by answer key), and short per-field guidance \
notes for the requester. Do not invent fields beyond what was supplied. Do \
not wrap the object in prose, markdown fences, or commentary — your output \
is parsed as structured output against a Zod schema.`;

/** Loads and caches every instruction file this adapter needs, once. */
export function loadInstructions(): CachedInstructions {
  const reviewerShared = readAgentFile("reviewer", "instructions.md");
  const reviewerTracks = new Map<GovernanceDomain, string>();
  for (const domain of KNOWN_DOMAINS) {
    reviewerTracks.set(
      domain,
      readAgentFile("reviewer", "tracks", TRACK_FILENAMES[domain]),
    );
  }
  const triage = readAgentFile("triage", "instructions.md");
  const auditor = readAgentFile("auditor", "instructions.md");
  const intake = readAgentFile("intake", "instructions.md");

  return {
    reviewerShared,
    reviewerTracks,
    triage,
    completeness: COMPLETENESS_FALLBACK_SYSTEM_PROMPT,
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
 * retryable/non-retryable split those shapes encode. The three constructors
 * below are the tiny, shared builders for those shapes so two adapters can
 * never drift into emitting subtly different `PortFailure` objects for the
 * same conceptual failure.
 */
export function providerFailure(
  message: string,
  retryable: boolean,
): PortFailure {
  return { kind: "provider", message, retryable };
}

export function timeoutFailure(
  timeoutMs: number,
  elapsedMs: number,
): PortFailure {
  return {
    kind: "timeout",
    message: `Invocation exceeded its ${timeoutMs}ms deadline.`,
    elapsedMs,
  };
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

/* -------------------------------------------------------------------------
 * checkCompleteness port-shape schema (Zod runtime validator)
 * ---------------------------------------------------------------------- */

export const completenessPortShapeSchema = z.object({
  complete: z.boolean(),
  missingFields: z.array(z.string()),
  notes: z.record(z.string(), z.string()),
});

/* -------------------------------------------------------------------------
 * Prompt builders — extracted from the bodies of the AgentPort methods so
 * every adapter builds byte-identical `system`/`prompt` strings. Object-
 * literal key order below is preserved exactly as the original inline call
 * sites had it (key order is observable in tests' prompt assertions via
 * JSON.stringify).
 * ---------------------------------------------------------------------- */

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

export function buildTriagePrompt(
  instructions: CachedInstructions,
  input: TriageAssistInput,
): { system: string; prompt: string; computedTier: RiskTier } {
  // agents/triage/instructions.md hard rule: "Tier and domain routing are
  // computed by deterministic code (`lib/triage`), never by you." The
  // model is TOLD the already-computed tier as input content and only
  // narrates it — so the tier we return must come from OUR input, never
  // from model output, and we pass it into the call payload below.
  const computedTier = tierFromAnswers(input.intake.answers);
  const prompt = JSON.stringify({
    intake: input.intake,
    computedTier,
  });

  return { system: instructions.triage, prompt, computedTier };
}

export function buildCompletenessPrompt(
  instructions: CachedInstructions,
  input: CompletenessCheckInput,
): { system: string; prompt: string } {
  const prompt = JSON.stringify({ intake: input.intake });
  return { system: instructions.completeness, prompt };
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
