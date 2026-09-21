/**
 * Real `AgentPort` implementation backed by the Vercel AI SDK (`ai` v7) and
 * `@ai-sdk/openai` (plan.md §4 P0 gate decision — see agents/README.md
 * "Why eve doesn't apply here"). One `generateText` + `Output.object`
 * structured-output round trip per call, no multi-turn tool loop, SDK retries disabled; retry policy stays with the caller.
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
 * Provider-agnostic logic (instruction-file loading,
 * domain helpers, pre-call validation, the prompt builders, and the
 * provider-agnostic slice of the PortFailure mapping contract) lives in
 * `./adapter-shared` so a second adapter (OpenAI Agents SDK) can reuse it
 * verbatim. This file keeps only what is genuinely AI-SDK-specific:
 * `callStructured`, `mapCallErrorToPortFailure`, and the factories.
 */
import { createHash } from "node:crypto";
import { APICallError, generateText, Output } from "ai";
import { invokeWithDeadline } from "./invoke";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import {
  auditorAnswerOutputSchema,
  intakeInterviewOutputSchema,
  reviewerDraftOutputSchema,
  mapReviewerDraftToPortOutput,
} from "./schemas";
import {
  TEMPERATURE,
  buildAuditorPrompt,
  buildDraftReviewPrompt,
  buildIntakeInterviewPrompt,
  cancelledFailure,
  isAbortError,
  loadInstructions,
  mapModelOutputSchemaFailure,
  providerFailure,
  validateDraftReviewInput,
} from "./adapter-shared";
import type {
  AgentPort,
  AuditorAnswerInput,
  AuditorAnswerOutput,
  DraftReviewInput,
  DraftReviewOutput,
  IntakeInterviewInput,
  IntakeInterviewOutput,
  InvokeOptions,
  PortFailure,
  PortResult,
} from "./ports";
import { resolveAgentRuntimeConfig } from "./runtime";

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
function mapCallErrorToPortFailure(err: unknown): PortFailure {
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
    return invokeWithDeadline(
      async (signal) => {
        const result = await generateText({
          model,
          system,
          prompt: userPrompt,
          output: Output.object({ schema }),
          temperature: TEMPERATURE,
          abortSignal: signal,
          // Retry policy belongs to the caller, where budget and attempts are bounded.
          maxRetries: 0,
        });
        return result.output;
      },
      mapCallErrorToPortFailure,
      options,
    );
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
        value: {
          ...mapReviewerDraftToPortOutput(input.domain, parsed.data),
          generationMetadata: {
            adapter: "vercel-ai-sdk",
            configuredModelId: typeof model === "string" ? model : model.modelId,
            systemPromptHash: createHash("sha256").update(system).digest("hex"),
            userPromptHash: createHash("sha256").update(userPrompt).digest("hex"),
            promptHashScope: "initial-input",
          },
        },
      };
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
      return { ok: true, value: { ...parsed.data, queryUsed: input.queryUsed } };
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
  const modelId = resolveAgentRuntimeConfig().generalModel;
  return createOpenAIAgentPortWithModel(openai(modelId));
}
