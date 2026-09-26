/**
 * Second real `AgentPort` implementation, this one backed by the OpenAI
 * Agents SDK (`@openai/agents`) rather than the Vercel AI SDK
 * (`./openai-adapter.ts`). Exists to prove the port contract is genuinely
 * adapter-agnostic (plan.md §4) — app code never knows or cares which of
 * the two `AgentPort` implementations it is talking to.
 *
 * API surface actually verified against the installed @openai/agents@0.14.2
 * (node_modules/@openai/agents{,-core,-openai}/dist/*.d.ts) before writing
 * this file:
 *   - `Agent`, `run`, `tool`, `Runner`, `MaxTurnsExceededError`,
 *     `ModelBehaviorError`, `UserError`, `ToolCallError`,
 *     `setDefaultOpenAIKey`, `setTracingDisabled`, `setDefaultOpenAIClient`,
 *     `OpenAIProvider` are all real, present exports of "@openai/agents"
 *     (the last two via `agents-core`'s `export * from './tracing'` /
 *     `agents-openai`'s re-export, both re-exported wholesale by the
 *     top-level "@openai/agents" barrel).
 *   - `new Agent({ name, instructions, model, modelSettings, outputType,
 *     tools })` — `model` is `string | Model` (a plain model-id string is
 *     valid and is what we pass), `outputType` accepts a Zod schema,
 *     `tools` is `Tool<Context>[]`.
 *   - `run(agent, input, { signal, maxTurns })` resolves to a `RunResult`
 *     whose `finalOutput` getter holds the parsed structured value (or,
 *     under tool use, potentially the raw final message — see "Deep review
 *     mode" below).
 *   - `ModelSettings.reasoning?: { effort?: 'none'|'minimal'|'low'|'medium'|
 *     'high'|'xhigh'|'max'|null }` — confirmed in
 *     agents-core/dist/model.d.ts. NOTE: unlike `ModelSettings` itself,
 *     `ModelSettingsReasoningEffort`/`ModelSettingsReasoning` are NOT named
 *     in the top-level barrel's re-export list for `./model`, so this file
 *     derives the effort type via `NonNullable<ModelSettings["reasoning"]>
 *     ["effort"]` rather than importing an unexported type name.
 *   - The five error classes above are real constructors usable with
 *     `instanceof` (confirmed in agents-core/dist/errors.d.ts).
 *
 * Provider-agnostic logic (instruction-file loading,
 * domain helpers, pre-call validation, the prompt builders, and the
 * provider-agnostic slice of the PortFailure mapping contract) is reused
 * verbatim from `./adapter-shared` — see that module's doc comment. This
 * file keeps only what is genuinely OpenAI-Agents-SDK-specific: `Agent`
 * construction, `run()` invocation/cancellation/timeout racing, this SDK's
 * own error-type mapping, and the deep-review (policy-corpus tool use) path.
 *
 * Model routing (env-overridable): intakeInterview and auditorAnswer use
 * OPENAI_LUNA_MODEL; draftReview uses OPENAI_TERRA_MODEL. Deep review adds
 * bounded, read-only policy tools to the same application-owned draft call.
 *
 * Reasoning effort defaults to `OPENAI_REASONING_EFFORT ?? "low"` (falling
 * back to "low" on an unrecognised value rather than crashing) for the same
 * reason: this is a live demo, and Luna specifically has very high
 * time-to-first-token at max reasoning effort. "low" keeps every port
 * method's latency demo-appropriate; a deployment that cares more about
 * answer quality than latency can raise it via the env var.
 *
 * Tracing: `setTracingDisabled(true)` unless `JEEVES_AGENT_TRACING === "1"`.
 * OFF by default because the OpenAI Agents SDK otherwise ships execution
 * traces (prompts, tool calls, outputs) to OpenAI's tracing backend by
 * default — this repo's honesty posture (agents/README.md, AGENTS.md rule 6:
 * "Synthetic data — demo", no undisclosed data egress) and its fully-offline
 * test suite (no network access, ever — see this file's own test) both
 * forbid that unless a human has explicitly opted in via the env var.
 */
import { createHash } from "node:crypto";
import {
  Agent,
  run as sdkRun,
  MaxTurnsExceededError,
  ModelBehaviorError,
  ToolCallError,
  UserError,
  setDefaultOpenAIKey,
  setTracingDisabled,
} from "@openai/agents";
import type { ModelSettings, Tool } from "@openai/agents";
import { resolveAgentRuntimeConfig } from "./runtime";
import {
  auditorAnswerOutputSchema,
  intakeInterviewOutputSchema,
  mapReviewerDraftToPortOutput,
  reviewerDraftOutputSchema,
} from "./schemas";
import {
  KNOWN_DOMAINS,
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
import { createPolicyCorpusTools } from "./policy-corpus";
import { invokeWithDeadline } from "./invoke";
import type {
  AgentPort,
  AuditorAnswerInput,
  AuditorAnswerOutput,
  DraftReviewInput,
  DraftReviewOutput,
  GovernanceDomain,
  IntakeInterviewInput,
  IntakeInterviewOutput,
  InvokeOptions,
  PortFailure,
  PortResult,
} from "./ports";

/* -------------------------------------------------------------------------
 * Model routing + reasoning effort
 * ---------------------------------------------------------------------- */

type ReasoningEffort = NonNullable<ModelSettings["reasoning"]>["effort"];

const ALLOWED_REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** Falls back to "low" on an unrecognised value rather than throwing. */
function resolveReasoningEffort(): ReasoningEffort {
  const raw = process.env.OPENAI_REASONING_EFFORT ?? "low";
  return (
    ALLOWED_REASONING_EFFORTS.has(raw) ? raw : "low"
  ) as ReasoningEffort;
}

/* -------------------------------------------------------------------------
 * Test seam: the shape of the SDK's `run` this adapter actually calls.
 * Production wires the real `run` from "@openai/agents"; tests inject a
 * fake that never touches the network.
 * ---------------------------------------------------------------------- */

export type AgentsRunFn = (
  // The real `run()` is generic over heterogeneous per-agent output/context
  // types; this adapter only ever needs to read `finalOutput` off the
  // result, so a narrower structural type here (rather than plumbing the
  // SDK's full generic signature through) is the honest shape of what we
  // actually use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: Agent<any, any>,
  input: string,
  options?: { readonly signal?: AbortSignal; readonly maxTurns?: number },
) => Promise<{ readonly finalOutput?: unknown }>;

/* -------------------------------------------------------------------------
 * Error mapping (this adapter's own provider-error-type mapping — see
 * ./adapter-shared's doc comment on the PortFailure mapping CONTRACT: each
 * adapter owns this, but must produce the same shapes via the shared
 * providerFailure/cancelledFailure constructors).
 * ---------------------------------------------------------------------- */

/**
 * Defensively extracts an HTTP status code from whatever shape the
 * underlying OpenAI client/SDK error happens to expose — `status`,
 * `statusCode`, or a nested `response.status` — without assuming any one of
 * them is present (the brief is explicit that this varies).
 */
function extractErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  const rec = err as Record<string, unknown>;
  if (typeof rec.status === "number") {
    return rec.status;
  }
  if (typeof rec.statusCode === "number") {
    return rec.statusCode;
  }
  const response = rec.response;
  if (typeof response === "object" && response !== null) {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

/**
 * Maps any error thrown by a `run()` call to a `PortFailure`. The ONLY place
 * a raw SDK/provider error object is allowed to cross the port boundary
 * (AGENTS.md rule 2 / ports.ts: "no raw provider errors may cross the port
 * boundary").
 */
function mapAgentsErrorToPortFailure(
  err: unknown,
  maxTurns: number | undefined,
): PortFailure {
  if (isAbortError(err)) {
    return cancelledFailure();
  }

  if (err instanceof MaxTurnsExceededError) {
    return providerFailure(
      `Agent run exceeded the maximum of ${maxTurns ?? "the configured"} turns.`,
      false,
    );
  }

  // ModelBehaviorError (the model did something the SDK didn't expect),
  // UserError (our own misconfiguration of the SDK call), and ToolCallError
  // (a tool invocation itself failed, only reachable in deep mode) are all
  // non-retryable: none of these are the kind of transient provider hiccup a
  // retry is likely to fix.
  if (
    err instanceof ModelBehaviorError ||
    err instanceof UserError ||
    err instanceof ToolCallError
  ) {
    return providerFailure(err.message, false);
  }

  const status = extractErrorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  if (status !== undefined) {
    // 429/5xx retryable; other 4xx not — same split as openai-adapter.ts's
    // APICallError#isRetryable, applied here from the raw HTTP status since
    // this SDK doesn't expose an equivalent boolean directly.
    const retryable = status === 429 || (status >= 500 && status < 600);
    return providerFailure(message, retryable);
  }

  // Unrecognised throw (network failure, etc.) — not enough information to
  // safely recommend a retry.
  return providerFailure(message, false);
}

/* -------------------------------------------------------------------------
 * Deep review mode (draftReview only) — policy-corpus tool use
 * ---------------------------------------------------------------------- */

/** Hard cap on tool-use turns for a deep-review run; see error mapping above. */
const DEEP_REVIEW_MAX_TURNS = 15;

const DEEP_REVIEW_TAIL = `

---

## Deep review mode

You have access to two read-only tools over the governance policy corpus:
\`read_policy_file\` and \`search_policy\`, sandboxed to \`docs/policies/\` and
\`agents/reviewer/\`. Use them to verify citations and grounding claims
against the actual policy text before drafting — do not rely on a
paraphrased memory of policy content. Once you have gathered what you need,
your FINAL message must be ONLY a single JSON object matching the
ReviewerDraftOutput shape (assessmentMd, citations, evidenceRequests,
recommendation, suggestedConditions, confidenceNotes) — no prose, no
markdown fences, no commentary before or after the JSON.`;

/** Strips a single ```/```json fenced block, if present, else returns input unchanged. */
function stripMarkdownFences(raw: string): string {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1] : raw;
}

/**
 * A tool-using deep-review run may end with prose-wrapped or fenced JSON as
 * its final message (a plain string) rather than the pre-parsed object
 * standard mode gets from `outputType` enforcement. Normalises both cases
 * down to a value ready for `reviewerDraftOutputSchema.safeParse`.
 */
function coerceDeepReviewOutput(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  const stripped = stripMarkdownFences(raw).trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Let safeParse fail naturally below and produce proper Zod issues.
    return stripped;
  }
}

/* -------------------------------------------------------------------------
 * Adapter factory (takes an explicit runFn so tests can inject a fake that
 * never touches the network — mirrors openai-adapter.ts's
 * createOpenAIAgentPortWithModel test seam).
 * ---------------------------------------------------------------------- */

export function createOpenAiAgentsAdapterWithRunner(
  runFn: AgentsRunFn,
): AgentPort {
  const instructions = loadInstructions();
  const modelSettings: ModelSettings = {
    reasoning: { effort: resolveReasoningEffort() },
  };
  // The directly injected runner still executes the Agents SDK adapter even
  // when the deployment selector is unset in a unit test.
  const runtime = resolveAgentRuntimeConfig({ ...process.env, JEEVES_AGENT_RUNTIME: "agents-sdk" });
  const luna = runtime.chatModel;
  const terra = runtime.reviewerModel;
  // Read once at adapter creation, same as the model-id/reasoning-effort env
  // reads above — a given adapter instance's deep-review behavior is fixed
  // for its lifetime, not re-checked per call.
  const deepReviewEnabled = process.env.JEEVES_DEEP_REVIEW === "1";

  const auditorAgent = new Agent({
    name: "jeeves-auditor",
    instructions: instructions.auditor,
    model: luna,
    modelSettings,
    outputType: auditorAnswerOutputSchema,
  });

  const intakeAgent = new Agent({
    name: "jeeves-intake",
    instructions: instructions.intake,
    model: luna,
    modelSettings,
    outputType: intakeInterviewOutputSchema,
  });

  // See AgentsRunFn's doc comment above for the no-explicit-any rationale.
  const draftReviewAgents = new Map<
    GovernanceDomain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Agent<any, any>
  >();
  for (const domain of KNOWN_DOMAINS) {
    const trackOverlay = instructions.reviewerTracks.get(domain);
    const system = trackOverlay
      ? `${instructions.reviewerShared}\n\n---\n\n${trackOverlay}`
      : instructions.reviewerShared;
    draftReviewAgents.set(
      domain,
      new Agent({
        name: `jeeves-reviewer-${domain}`,
        instructions: system,
        model: terra,
        modelSettings,
        // Standard mode: no tools — a single-shot structured call.
        tools: [],
        outputType: reviewerDraftOutputSchema,
      }),
    );
  }

  /** SDK-specific invocation; the shared runner owns its terminal outcome. */
  async function callAgent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agent: Agent<any, any>,
    userPrompt: string,
    options: InvokeOptions | undefined,
    runOptions: { readonly maxTurns?: number } = {},
  ): Promise<PortResult<unknown>> {
    return invokeWithDeadline(
      async (signal) => {
        const result = await runFn(agent, userPrompt, {
          signal,
          maxTurns: runOptions.maxTurns,
        });
        return result.finalOutput;
      },
      (error) => mapAgentsErrorToPortFailure(error, runOptions.maxTurns),
      options,
    );
  }

  /**
   * The deep-review path builds its Agent (and its tools) fresh per call,
   * unlike the standard-mode Agents above. Documented judgment call:
   * `createPolicyCorpusTools`'s `onRead` callback must be able to name
   * *this* call's `invocationId`/`onProgress` in each "reading-policy"
   * event it emits. Baking a single shared deep-review Agent (and its tools)
   * at adapter-creation time would force `onRead` to close over some
   * mutable "current call" pointer shared across every concurrent
   * draftReview invocation — under concurrent deep-mode calls that is a
   * cross-talk bug (call A's tool reads could get attributed to call B's
   * progress stream). Building fresh per call costs one extra `Agent`
   * object per deep-mode draftReview call, which is negligible next to the
   * multi-turn tool-use round trip it wraps.
   */
  async function runDeepDraftReview(
    input: DraftReviewInput,
    userPrompt: string,
    options: InvokeOptions | undefined,
  ): Promise<PortResult<DraftReviewOutput>> {
    const invocationId = `openai-agents-draft-deep-${input.reviewCycleId}-${input.domain}`;
    const trackOverlay = instructions.reviewerTracks.get(input.domain);
    const system = trackOverlay
      ? `${instructions.reviewerShared}\n\n---\n\n${trackOverlay}`
      : instructions.reviewerShared;

    const tools = createPolicyCorpusTools((label) => {
      options?.onProgress?.({
        invocationId,
        stage: "reading-policy",
        message: label,
        at: new Date().toISOString(),
      });
    });

    const deepAgent = new Agent({
      name: `jeeves-reviewer-deep-${input.domain}`,
      instructions: `${system}${DEEP_REVIEW_TAIL}`,
      model: terra,
      modelSettings,
      tools: tools as Tool[],
      outputType: reviewerDraftOutputSchema,
    });

    const result = await callAgent(deepAgent, userPrompt, options, {
      maxTurns: DEEP_REVIEW_MAX_TURNS,
    });
    if (!result.ok) {
      return result;
    }

    const candidate = coerceDeepReviewOutput(result.value);
    const parsed = reviewerDraftOutputSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
    }

    return {
      ok: true,
      value: {
        ...mapReviewerDraftToPortOutput(input.domain, parsed.data),
        generationMetadata: {
          adapter: "openai-agents-sdk",
          configuredModelId: terra,
          mode: "deep",
          systemPromptHash: createHash("sha256").update(`${system}${DEEP_REVIEW_TAIL}`).digest("hex"),
          userPromptHash: createHash("sha256").update(userPrompt).digest("hex"),
          // Tool responses occur after these prompts; do not claim this hash
          // identifies the entire multi-turn provider transcript.
          promptHashScope: "initial-input",
        },
      },
    };
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
        invocationId: `openai-agents-draft-${input.reviewCycleId}-${input.domain}`,
        stage: "drafting",
        at: new Date().toISOString(),
      });

      if (deepReviewEnabled) {
        return runDeepDraftReview(input, userPrompt, options);
      }

      // draftReviewAgents is guaranteed to have an entry for every domain in
      // KNOWN_DOMAINS, and validateDraftReviewInput above already rejected
      // any domain outside that set.
      const agent = draftReviewAgents.get(input.domain);
      if (!agent) {
        return {
          ok: false,
          error: {
            kind: "validation",
            message: "draftReview input failed pre-call validation.",
            issues: ["domain"],
          },
        };
      }

      const result = await callAgent(agent, userPrompt, options);
      if (!result.ok) {
        return result;
      }

      const parsed = reviewerDraftOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }

      return {
        ok: true,
        value: {
          ...mapReviewerDraftToPortOutput(input.domain, parsed.data),
          generationMetadata: {
            adapter: "openai-agents-sdk",
            configuredModelId: terra,
            mode: "standard",
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
      const { prompt: userPrompt } = buildAuditorPrompt(instructions, input);

      options?.onProgress?.({
        invocationId: `openai-agents-auditor-${input.queryUsed}`,
        stage: "answering",
        at: new Date().toISOString(),
      });

      const result = await callAgent(auditorAgent, userPrompt, options);
      if (!result.ok) {
        return result;
      }

      const parsed = auditorAnswerOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }

      // ports.ts contract: `queryUsed` is "echoed back verbatim from the
      // input" — so it comes from OUR input, not from whatever the model
      // happened to put in its own output, even though the schema also
      // requires the field.
      return {
        ok: true,
        value: {
          answerMd: parsed.data.answerMd,
          citedEvents: parsed.data.citedEvents,
          queryUsed: input.queryUsed,
        },
      };
    },

    async intakeInterview(
      input: IntakeInterviewInput,
      options?: InvokeOptions,
    ): Promise<PortResult<IntakeInterviewOutput>> {
      const { prompt: userPrompt } = buildIntakeInterviewPrompt(
        instructions,
        input,
      );

      options?.onProgress?.({
        invocationId: `openai-agents-intake-${input.conversation.length}`,
        stage: "interviewing",
        at: new Date().toISOString(),
      });

      const result = await callAgent(intakeAgent, userPrompt, options);
      if (!result.ok) {
        return result;
      }

      const parsed = intakeInterviewOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: mapModelOutputSchemaFailure(parsed.error) };
      }
      return { ok: true, value: parsed.data };
    },
  };
}

/**
 * Builds the real OpenAI-Agents-SDK-backed `AgentPort`.
 *
 * `setDefaultOpenAIKey` is only called when `OPENAI_API_KEY` is actually
 * set (mirrors `lib/agents/index.ts`'s own key-presence gate around which
 * adapter to construct at all) — calling it with an empty/undefined key
 * would just replace a possibly-already-configured default with nothing.
 * `setTracingDisabled` runs unconditionally on every call to keep this
 * adapter's tracing posture correct regardless of construction order
 * relative to other code that might call SDK setters — see this file's top
 * doc comment for why tracing defaults OFF.
 */
export function createOpenAiAgentsAdapter(): AgentPort {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    setDefaultOpenAIKey(apiKey);
  }
  setTracingDisabled(process.env.JEEVES_AGENT_TRACING !== "1");

  return createOpenAiAgentsAdapterWithRunner(sdkRun as AgentsRunFn);
}
