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
 *
 * Provider-agnostic logic (instruction-file loading, deterministic tier/
 * domain helpers, pre-call validation, the five prompt builders, and the
 * provider-agnostic slice of the PortFailure mapping contract) lives in
 * `./adapter-shared` so a second adapter (OpenAI Agents SDK) can reuse it
 * verbatim. This file keeps only what is genuinely AI-SDK-specific:
 * `callStructured`, `mapCallErrorToPortFailure`, and the factories.
 */
import { APICallError, generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import {
  auditorAnswerOutputSchema,
  intakeInterviewOutputSchema,
  reviewerDraftOutputSchema,
  triageRationaleOutputSchema,
  mapReviewerDraftToPortOutput,
} from "./schemas";
import {
  TEMPERATURE,
  buildAuditorPrompt,
  buildCompletenessPrompt,
  buildDraftReviewPrompt,
  buildIntakeInterviewPrompt,
  buildTriagePrompt,
  cancelledFailure,
  completenessPortShapeSchema,
  isAbortError,
  loadInstructions,
  mapModelOutputSchemaFailure,
  providerFailure,
  timeoutFailure,
  validateDraftReviewInput,
} from "./adapter-shared";
import type {
  AgentPort,
  AuditorAnswerInput,
  AuditorAnswerOutput,
  CompletenessCheckInput,
  CompletenessCheckOutput,
  DraftReviewInput,
  DraftReviewOutput,
  IntakeInterviewInput,
  IntakeInterviewOutput,
  InvokeOptions,
  PortFailure,
  PortResult,
  TriageAssistInput,
  TriageAssistOutput,
} from "./ports";

/* -------------------------------------------------------------------------
 * Error mapping
 * ---------------------------------------------------------------------- */

/**
 * Maps any error thrown by a `generateText` call to a `PortFailure`. This is
 * the ONLY place raw provider/runtime errors are allowed to cross the port
 * boundary (ports.ts's own doc comment: "no raw provider errors may cross
 * the port boundary").
 *
 * This mapping is AI-SDK-specific (switches on `APICallError`) and therefore
 * stays here rather than in `./adapter-shared` — see that module's doc
 * comment on the PortFailure mapping contract: each adapter owns its own
 * provider-error-type mapping, but must produce the same shapes and the same
 * retryable/non-retryable split, via the shared `providerFailure`/
 * `cancelledFailure` constructors.
 */
function mapCallErrorToPortFailure(err: unknown, elapsedMs: number): PortFailure {
  if (isAbortError(err)) {
    return cancelledFailure();
  }

  if (APICallError.isInstance(err)) {
    // 429/5xx-style errors are retryable; other 4xx-style errors are not.
    // `isRetryable` on APICallError already encodes exactly this split.
    return providerFailure(err.message, err.isRetryable);
  }

  // Any other unexpected throw (network failure, JSON parse failure inside
  // the SDK, etc.) is treated as a non-retryable provider failure — we do
  // not know enough about it to safely recommend a retry.
  const message = err instanceof Error ? err.message : String(err);
  void elapsedMs; // reserved for a future explicit timeout measurement path
  return providerFailure(message, false);
}

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
      return { ok: false, error: cancelledFailure() };
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

    const buildTimeoutResult = (): PortResult<T> => ({
      ok: false,
      error: timeoutFailure(timeoutMs as number, Date.now() - startedAt),
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
        return buildTimeoutResult();
      }

      return { ok: true, value: raced.output };
    } catch (err) {
      // Precedence: an explicit user abort is `cancelled` even when a
      // deadline was also set; only a deadline-triggered abort is `timeout`.
      if (options?.signal?.aborted) {
        return { ok: false, error: cancelledFailure() };
      }
      if (timedOut) {
        return buildTimeoutResult();
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

      const { system, prompt: userPrompt } = buildDraftReviewPrompt(
        instructions,
        input,
      );

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
      const {
        system,
        prompt: userPrompt,
        computedTier,
      } = buildTriagePrompt(instructions, input);

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
        system,
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
      const { system, prompt: userPrompt } = buildCompletenessPrompt(
        instructions,
        input,
      );

      options?.onProgress?.({
        invocationId: `openai-completeness-${input.intake.intakeVersionId}`,
        stage: "checking",
        at: new Date().toISOString(),
      });

      const result = await callStructured(
        system,
        userPrompt,
        completenessPortShapeSchema,
        options,
      );
      if (!result.ok) return result;

      const parsed = completenessPortShapeSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return { ok: true, value: parsed.data };
    },

    async auditorAnswer(
      input: AuditorAnswerInput,
      options?: InvokeOptions,
    ): Promise<PortResult<AuditorAnswerOutput>> {
      const { system, prompt: userPrompt } = buildAuditorPrompt(
        instructions,
        input,
      );

      options?.onProgress?.({
        invocationId: `openai-auditor-${input.queryUsed}`,
        stage: "answering",
        at: new Date().toISOString(),
      });

      const result = await callStructured(
        system,
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
      const { system, prompt: userPrompt } = buildIntakeInterviewPrompt(
        instructions,
        input,
      );

      options?.onProgress?.({
        invocationId: `openai-intake-${input.conversation.length}`,
        stage: "interviewing",
        at: new Date().toISOString(),
      });

      const result = await callStructured(
        system,
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
