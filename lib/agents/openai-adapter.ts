/**
 * Real `AgentPort` implementation backed by the Vercel AI SDK (`ai` v7) and
 * `@ai-sdk/openai` (plan.md §4 P0 gate decision — see agents/README.md
 * "Why eve doesn't apply here"). One `generateText` + `Output.object`
 * structured-output round trip per call, no multi-turn tool loop, no hidden
 * retries beyond what the AI SDK itself does at the HTTP layer.
 *
 * API surface actually verified against the installed ai@7.0.22 /
 * @ai-sdk/openai@4.0.11 (node_modules/ai/dist/index.d.ts,
 * node_modules/ai/dist/test/index.d.ts) before writing this file:
 *   - `generateText({ model, system, prompt, output, temperature,
 *     abortSignal })` from "ai" — `output` accepts an `Output.object({schema})`
 *     spec (the `Output` export is `output as Output` in dist/index.d.ts);
 *     the parsed structured value is read off `result.output`.
 *   - `openai(modelId)` from "@ai-sdk/openai" returns a `LanguageModelV4`.
 *   - Provider errors surface as `APICallError` (from "ai"), which carries
 *     `statusCode` and `isRetryable` — used directly for the
 *     retryable/non-retryable PortFailure split.
 *   - `RequestOptions.abortSignal` is a real, honored option.
 */
import { APICallError, generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import {
  auditorAnswerOutputSchema,
  intakeInterviewOutputSchema,
  reviewerDraftOutputSchema,
  triageRationaleOutputSchema,
  mapReviewerDraftToPortOutput,
} from "./schemas";
import type {
  AgentPort,
  AuditorAnswerInput,
  AuditorAnswerOutput,
  CompletenessCheckInput,
  CompletenessCheckOutput,
  DraftReviewInput,
  DraftReviewOutput,
  GovernanceDomain,
  IntakeInterviewInput,
  IntakeInterviewOutput,
  InvokeOptions,
  PortFailure,
  PortResult,
  RiskTier,
  TriageAssistInput,
  TriageAssistOutput,
} from "./ports";

/* -------------------------------------------------------------------------
 * Instruction-file loading (constructed once, cached in memory)
 * ---------------------------------------------------------------------- */

const KNOWN_DOMAINS: readonly GovernanceDomain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

function isGovernanceDomain(value: unknown): value is GovernanceDomain {
  return (
    typeof value === "string" &&
    (KNOWN_DOMAINS as readonly string[]).includes(value)
  );
}

const RISK_TIERS: readonly RiskTier[] = ["low", "medium", "high", "critical"];

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
function tierFromAnswers(
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
 */
function repoAgentsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  return path.join(thisDir, "..", "..", "agents");
}

function readAgentFile(...segments: string[]): string {
  return readFileSync(path.join(repoAgentsDir(), ...segments), "utf-8");
}

interface CachedInstructions {
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

const TRACK_FILENAMES: Record<GovernanceDomain, string> = {
  legal: "legal.md",
  procurement: "procurement.md",
  "tech-architecture": "tech-architecture.md",
  "responsible-ai": "responsible-ai.md",
  security: "security.md",
  "privacy-hipaa": "privacy-hipaa.md",
  "clinical-safety": "clinical-safety.md",
  "data-governance": "data-governance.md",
};

const COMPLETENESS_FALLBACK_SYSTEM_PROMPT = `You are an intake-completeness checking assistant for Jeeves, the AI \
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
function loadInstructions(): CachedInstructions {
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
 * Error mapping
 * ---------------------------------------------------------------------- */

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

/**
 * Maps any error thrown by a `generateText` call to a `PortFailure`. This is
 * the ONLY place raw provider/runtime errors are allowed to cross the port
 * boundary (ports.ts's own doc comment: "no raw provider errors may cross
 * the port boundary").
 */
function mapCallErrorToPortFailure(err: unknown, elapsedMs: number): PortFailure {
  if (isAbortError(err)) {
    return { kind: "cancelled" };
  }

  if (APICallError.isInstance(err)) {
    // 429/5xx-style errors are retryable; other 4xx-style errors are not.
    // `isRetryable` on APICallError already encodes exactly this split.
    return {
      kind: "provider",
      message: err.message,
      retryable: err.isRetryable,
    };
  }

  // Any other unexpected throw (network failure, JSON parse failure inside
  // the SDK, etc.) is treated as a non-retryable provider failure — we do
  // not know enough about it to safely recommend a retry.
  const message = err instanceof Error ? err.message : String(err);
  void elapsedMs; // reserved for a future explicit timeout measurement path
  return { kind: "provider", message, retryable: false };
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
function mapModelOutputSchemaFailure(zodError: z.ZodError): PortFailure {
  return {
    kind: "provider",
    message: `Model output failed schema validation: ${zodError.message}`,
    retryable: false,
  };
}

/* -------------------------------------------------------------------------
 * Input validation (pre-call, kind: "validation")
 * ---------------------------------------------------------------------- */

function validateDraftReviewInput(
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
const TEMPERATURE = 0.1;

/* -------------------------------------------------------------------------
 * Adapter factory (takes an explicit LanguageModel so tests can inject
 * MockLanguageModelV4 from "ai/test" without any network access)
 * ---------------------------------------------------------------------- */

export function createOpenAIAgentPortWithModel(model: LanguageModel): AgentPort {
  const instructions = loadInstructions();

  async function callStructured<T>(
    system: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    options?: InvokeOptions,
  ): Promise<PortResult<T>> {
    if (options?.signal?.aborted) {
      return { ok: false, error: { kind: "cancelled" } };
    }

    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs;

    // Internal controller handed to the SDK: lets a timeoutMs overrun abort
    // the in-flight provider call, with the caller's own signal (when
    // present) propagated into it so both abort paths share one signal.
    const controller = new AbortController();
    const onUserAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onUserAbort, { once: true });

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const timeoutFailure = (): PortResult<T> => ({
      ok: false,
      error: {
        kind: "timeout",
        message: `Invocation exceeded its ${timeoutMs}ms deadline.`,
        elapsedMs: Date.now() - startedAt,
      },
    });

    try {
      const call = generateText({
        model,
        system,
        prompt: userPrompt,
        output: Output.object({ schema }),
        temperature: TEMPERATURE,
        abortSignal: controller.signal,
        // agents/README.md: "no hidden retries that silently change the
        // output shape." The AI SDK's own `generateText` defaults to
        // `maxRetries: 2` with backoff, which would both violate that rule
        // and turn a single retryable-provider-error PortFailure into a
        // multi-second hidden retry loop before surfacing. We disable the
        // SDK's built-in retry entirely and let the PortFailure's
        // `retryable` flag inform the CALLER's own retry decision instead.
        maxRetries: 0,
      });

      // ports.ts InvokeOptions.timeoutMs: "Hard deadline; adapters map
      // overruns to the `timeout` failure." Race the call against the
      // deadline rather than trusting the provider to honor the abort — a
      // hung provider (or a mock model that never settles) must still time
      // out from the caller's perspective.
      const raced =
        timeoutMs === undefined
          ? await call
          : await Promise.race([
              call,
              new Promise<"deadline">((resolve) => {
                deadlineTimer = setTimeout(() => {
                  timedOut = true;
                  controller.abort();
                  resolve("deadline");
                }, timeoutMs);
              }),
            ]);

      if (raced === "deadline") {
        // Detach the aborted in-flight call so its eventual rejection does
        // not surface as an unhandled rejection.
        call.catch(() => {});
        return timeoutFailure();
      }

      return { ok: true, value: raced.output };
    } catch (err) {
      // Precedence: an explicit user abort is `cancelled` even when a
      // deadline was also set; only a deadline-triggered abort is `timeout`.
      if (options?.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled" } };
      }
      if (timedOut) {
        return timeoutFailure();
      }
      const elapsedMs = Date.now() - startedAt;
      return { ok: false, error: mapCallErrorToPortFailure(err, elapsedMs) };
    } finally {
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
      options?.signal?.removeEventListener("abort", onUserAbort);
    }
  }

  return {
    async draftReview(
      input: DraftReviewInput,
      options?: InvokeOptions,
    ): Promise<PortResult<DraftReviewOutput>> {
      const validationFailure = validateDraftReviewInput(input);
      if (validationFailure) {
        return { ok: false, error: validationFailure };
      }

      const trackOverlay = instructions.reviewerTracks.get(input.domain);
      const system = trackOverlay
        ? `${instructions.reviewerShared}\n\n---\n\n${trackOverlay}`
        : instructions.reviewerShared;

      const userPrompt = JSON.stringify({
        reviewCycleId: input.reviewCycleId,
        domain: input.domain,
        intake: input.intake,
        policyContext: input.policyContext ?? [],
      });

      options?.onProgress?.({
        invocationId: `openai-draft-${input.reviewCycleId}-${input.domain}`,
        stage: "drafting",
        at: new Date().toISOString(),
      });

      const richResult = await callStructured(
        system,
        userPrompt,
        reviewerDraftOutputSchema,
        options,
      );

      if (!richResult.ok) {
        return richResult;
      }

      // Re-validate explicitly with .safeParse so a malformed-but-JSON-shaped
      // model output (e.g. valid JSON, wrong shape) is caught even if the AI
      // SDK's own internal validation was lenient — see
      // mapModelOutputSchemaFailure's doc comment above for why this maps to
      // kind:"provider", not kind:"validation".
      const parsed = reviewerDraftOutputSchema.safeParse(richResult.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }

      return {
        ok: true,
        value: mapReviewerDraftToPortOutput(input.domain, parsed.data),
      };
    },

    async triageAssist(
      input: TriageAssistInput,
      options?: InvokeOptions,
    ): Promise<PortResult<TriageAssistOutput>> {
      // agents/triage/instructions.md hard rule: "Tier and domain routing are
      // computed by deterministic code (`lib/triage`), never by you." The
      // model is TOLD the already-computed tier as input content and only
      // narrates it — so the tier we return must come from OUR input, never
      // from model output, and we pass it into the call payload below.
      const computedTier = tierFromAnswers(input.intake.answers);
      const userPrompt = JSON.stringify({
        intake: input.intake,
        computedTier,
      });

      options?.onProgress?.({
        invocationId: `openai-triage-${input.intake.intakeVersionId}`,
        stage: "explaining",
        at: new Date().toISOString(),
      });

      // The model returns exactly the rich TriageRationaleOutput shape its
      // instructions.md documents (rationaleMd + flagExplanations) — asking
      // it for the port's shape (which includes suggestedTier) would
      // contradict its own never-compute-a-tier instruction. The mapping
      // down to the port's TriageAssistOutput is: rationale = rationaleMd,
      // signals = the flags the model explained, suggestedTier = the
      // deterministic input tier from above.
      const result = await callStructured(
        instructions.triage,
        userPrompt,
        triageRationaleOutputSchema,
        options,
      );
      if (!result.ok) return result;

      const parsed = triageRationaleOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return {
        ok: true,
        value: {
          suggestedTier: computedTier,
          rationale: parsed.data.rationaleMd,
          signals: parsed.data.flagExplanations.map((f) => f.flag),
        },
      };
    },

    async checkCompleteness(
      input: CompletenessCheckInput,
      options?: InvokeOptions,
    ): Promise<PortResult<CompletenessCheckOutput>> {
      const userPrompt = JSON.stringify({ intake: input.intake });

      options?.onProgress?.({
        invocationId: `openai-completeness-${input.intake.intakeVersionId}`,
        stage: "checking",
        at: new Date().toISOString(),
      });

      const portShapeSchema = z.object({
        complete: z.boolean(),
        missingFields: z.array(z.string()),
        notes: z.record(z.string(), z.string()),
      });

      const result = await callStructured(
        instructions.completeness,
        userPrompt,
        portShapeSchema,
        options,
      );
      if (!result.ok) return result;

      const parsed = portShapeSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return { ok: true, value: parsed.data };
    },

    async auditorAnswer(
      input: AuditorAnswerInput,
      options?: InvokeOptions,
    ): Promise<PortResult<AuditorAnswerOutput>> {
      // No rich-to-port mapping step here (unlike draftReview): per
      // agents/auditor/instructions.md, the model's AuditorAnswerOutput IS
      // the port shape verbatim (see lib/agents/schemas.ts's doc comment on
      // auditorAnswerOutputSchema). The user prompt is exactly the question,
      // the already-fetched grounding rows, and which query produced them —
      // the model never chooses or runs a query itself (instructions.md
      // "What you will receive").
      const userPrompt = JSON.stringify({
        question: input.question,
        groundingRows: input.groundingRows,
        queryUsed: input.queryUsed,
      });

      options?.onProgress?.({
        invocationId: `openai-auditor-${input.queryUsed}`,
        stage: "answering",
        at: new Date().toISOString(),
      });

      const result = await callStructured(
        instructions.auditor,
        userPrompt,
        auditorAnswerOutputSchema,
        options,
      );
      if (!result.ok) return result;

      const parsed = auditorAnswerOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return { ok: true, value: parsed.data };
    },

    async intakeInterview(
      input: IntakeInterviewInput,
      options?: InvokeOptions,
    ): Promise<PortResult<IntakeInterviewOutput>> {
      // Same no-mapping relationship as auditorAnswer above: the model's
      // IntakeInterviewOutput (agents/intake/instructions.md) IS the port
      // shape verbatim. The user prompt is the conversation so far and the
      // current partial payload — the model continues from there, per
      // instructions.md's "What you will receive."
      const userPrompt = JSON.stringify({
        conversation: input.conversation,
        partialPayload: input.partialPayload,
      });

      options?.onProgress?.({
        invocationId: `openai-intake-${input.conversation.length}`,
        stage: "interviewing",
        at: new Date().toISOString(),
      });

      const result = await callStructured(
        instructions.intake,
        userPrompt,
        intakeInterviewOutputSchema,
        options,
      );
      if (!result.ok) return result;

      const parsed = intakeInterviewOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return { ok: true, value: parsed.data };
    },
  };
}

/**
 * Factory function per the task brief: builds the real OpenAI-backed
 * `AgentPort`, reading the model id from `process.env.OPENAI_MODEL`
 * (fallback `'gpt-5.1'`, matching `.env.example`) — never hardcoded.
 */
export function createOpenAIAgentPort(): AgentPort {
  const modelId = process.env.OPENAI_MODEL ?? "gpt-5.1";
  return createOpenAIAgentPortWithModel(openai(modelId));
}

// Re-export the rich triage schema for callers that want the fuller
// TriageRationaleOutput shape directly (kept in sync with schemas.ts).
export { triageRationaleOutputSchema };
