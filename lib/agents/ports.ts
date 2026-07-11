/**
 * App-owned capability ports for agent and workflow execution — plan.md §4.
 *
 * These interfaces are the ONLY contract adapters may implement. Whether the
 * runtime is Vercel eve or the fallback (Vercel AI SDK + Workflow SDK) is an
 * adapter detail decided at the P0 spike; nothing in `app/` or `lib/` may
 * import an adapter directly — only these types.
 *
 * Hard rules reflected here (AGENTS.md):
 *  - Rule 1: agents draft, recommend, route, and flag missing evidence — they
 *    NEVER approve. No port result carries approval authority; outputs are
 *    recommendations that a named human acts on.
 *  - Rule 4: authoritative state transitions live in application code +
 *    Postgres, never inside adapters. Ports return data; the caller decides
 *    what (if anything) to persist or transition.
 */

/** The eight governance domains — plan.md §1 (all visible, all 8 drafted live). */
export type GovernanceDomain =
  | "legal"
  | "procurement"
  | "tech-architecture"
  | "responsible-ai"
  | "security"
  | "privacy-hipaa"
  | "clinical-safety"
  | "data-governance";

/** Deterministic risk tiers — plan.md §1 (healthcare overlay questions). */
export type RiskTier = "low" | "medium" | "high" | "critical";

/* -------------------------------------------------------------------------
 * Failure modes and results
 * ---------------------------------------------------------------------- */

/**
 * Every way an agent/workflow invocation can fail, as a discriminated union.
 * Callers switch on `kind`; adapters must map their runtime's errors into
 * exactly one of these — no raw provider errors may cross the port boundary.
 */
export type PortFailure =
  | {
      /** Input rejected before any provider call (schema, length caps). */
      kind: "validation";
      message: string;
      /** Field-level issues, when known (e.g. `intake.dataRetention`). */
      issues?: readonly string[];
    }
  | {
      /** The LLM/workflow provider errored or was unreachable. */
      kind: "provider";
      message: string;
      /** True when a retry is reasonable (e.g. 429/5xx), false for 4xx. */
      retryable: boolean;
    }
  | {
      /** The invocation exceeded its deadline. */
      kind: "timeout";
      message: string;
      elapsedMs: number;
    }
  | {
      /** Cancelled via AbortSignal or WorkflowRunHandle.cancel(). */
      kind: "cancelled";
      reason?: string;
    }
  | {
      /**
       * The atomic per-day run budget (plan.md §3, RunBudget in §5) refused
       * the call. Surfaced as a failure so the UI can render an honest
       * "demo budget exhausted" state instead of a provider error.
       */
      kind: "budget-exhausted";
      message: string;
    };

/** Result envelope for a single port invocation. */
export type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PortFailure };

/* -------------------------------------------------------------------------
 * Progress + invocation options (shared by both ports)
 * ---------------------------------------------------------------------- */

/** A single progress notification emitted while an invocation runs. */
export interface ProgressEvent {
  /** Stable id for the invocation this event belongs to. */
  readonly invocationId: string;
  /** Adapter-defined stage label, e.g. "retrieving-policy", "drafting". */
  readonly stage: string;
  /** Optional human-readable detail for UI streaming. */
  readonly message?: string;
  /** 0–100 when the adapter can estimate progress; omitted otherwise. */
  readonly percent?: number;
  /** ISO-8601 timestamp. */
  readonly at: string;
}

/**
 * Options accepted by every port method.
 * Cancellation is cooperative: adapters must observe `signal` and resolve
 * with `{ ok: false, error: { kind: "cancelled" } }` when it aborts.
 * Progress is callback-based here; WorkflowPort additionally exposes an
 * async-iterable event stream on its run handle.
 */
export interface InvokeOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: ProgressEvent) => void;
  /** Hard deadline; adapters map overruns to the `timeout` failure. */
  readonly timeoutMs?: number;
}

/* -------------------------------------------------------------------------
 * AgentPort — draft review, triage assist, completeness check (plan.md §4)
 * ---------------------------------------------------------------------- */

/**
 * A point-in-time snapshot of intake answers handed to an agent. Kept
 * intentionally loose until the real domain model lands (plan.md §5,
 * IntakeVersion); the port contract only promises "the answers as of a
 * specific intake version", never live DB access from inside an adapter.
 */
export interface IntakeSnapshot {
  readonly initiativeId: string;
  readonly intakeVersionId: string;
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface DraftReviewInput {
  readonly reviewCycleId: string;
  readonly domain: GovernanceDomain;
  readonly intake: IntakeSnapshot;
  /** Policy/catalog excerpts the draft must ground itself in. */
  readonly policyContext?: readonly string[];
}

/**
 * A draft for a human reviewer to edit and sign (plan.md §2 step 3).
 * Note `recommendation`, not `decision`: the port cannot approve (hard
 * rule 1) — a ReviewDecision is only created by app code when a named
 * human signs.
 */
export interface DraftReviewOutput {
  readonly domain: GovernanceDomain;
  readonly draftMarkdown: string;
  readonly recommendation:
    | "recommend-sign-off"
    | "recommend-conditional"
    | "recommend-return";
  /** Suggested conditions when recommending a conditional approval. */
  readonly suggestedConditions: readonly string[];
  /** Evidence the agent could not find — routed back to the requester. */
  readonly missingEvidence: readonly string[];
}

export interface TriageAssistInput {
  readonly intake: IntakeSnapshot;
}

/**
 * Advisory only. The authoritative tier comes from the deterministic
 * overlay-question rules in `lib/` (plan.md §1, §8 test 1) — this output
 * exists to explain and cross-check, never to decide.
 */
export interface TriageAssistOutput {
  readonly suggestedTier: RiskTier;
  readonly rationale: string;
  /** Overlay questions whose answers most influenced the suggestion. */
  readonly signals: readonly string[];
}

export interface CompletenessCheckInput {
  readonly intake: IntakeSnapshot;
}

/** Plan.md §2 step 1 — e.g. flags the missing data-retention answer. */
export interface CompletenessCheckOutput {
  readonly complete: boolean;
  /** Intake fields that are missing or insufficient, by answer key. */
  readonly missingFields: readonly string[];
  /** Per-field guidance the requester sees. */
  readonly notes: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------
 * Auditor agent port shapes (agents/auditor/instructions.md, M2) — natural-
 * language audit Q&A grounded on structured query rows fetched by the ROUTE
 * layer, never by the port/adapter itself (plan.md §4: adapters get data
 * handed to them, they never reach into lib/data on their own).
 * ---------------------------------------------------------------------- */

export interface AuditorAnswerInput {
  readonly question: string;
  /**
   * The structured query result rows the caller already fetched — either
   * `AuditQueryRow[]` (a canned query, `lib/data/dto.ts`) or `AuditEventRow[]`
   * (a structured-read fallback keyed off a specific initiative). Kept as
   * `readonly unknown[]` deliberately: `lib/agents` has no existing
   * dependency on `lib/data` anywhere in this file (confirmed — every other
   * port input here, e.g. `IntakeSnapshot.answers`, is `Record<string,
   * unknown>`-shaped rather than importing a `lib/data`/`lib/domain` row
   * type), and importing `AuditQueryRow`/`AuditEventRow` into this file
   * would be the first such cross-layer dependency. The port only needs to
   * know "an array of row-like objects to render context from," never the
   * concrete row shape — the route handler (`app/api/chat/auditor/route.ts`)
   * is where the concrete row type is known and fetched.
   */
  readonly groundingRows: readonly Readonly<Record<string, unknown>>[];
  /** The `CannedAuditQueryId` used, or a short label for an ad hoc query. */
  readonly queryUsed: string;
}

/**
 * Mirrors `agents/auditor/instructions.md`'s `AuditorAnswerOutput` exactly —
 * there is no richer-shape-to-port-shape mapping step for this agent (unlike
 * `DraftReviewOutput`/`ReviewerDraftOutput`). The Zod runtime validator for
 * this exact shape is `auditorAnswerOutputSchema` in `./schemas`; the two
 * declarations are kept in sync by hand per this file's existing
 * self-contained-interfaces convention (see `DraftReviewOutput` etc., which
 * likewise do not import their shape from `./schemas`).
 */
export interface AuditorAnswerOutput {
  readonly answerMd: string;
  /** Every event timestamp (ISO 8601) or decision id relied upon; empty on a refusal. */
  readonly citedEvents: readonly string[];
  /** The query id/label actually used, echoed back verbatim from the input. */
  readonly queryUsed: string;
}

/* -------------------------------------------------------------------------
 * Intake agent port shapes (agents/intake/instructions.md, M2) — the
 * conversational alternative to the M1 structured intake form.
 * ---------------------------------------------------------------------- */

export interface IntakeInterviewInput {
  /** The conversation so far, oldest first. */
  readonly conversation: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
  /**
   * The current partially-filled `IntakeVersion.payload` state (intake-spec
   * §3). Kept as `Readonly<Record<string, unknown>>` rather than importing
   * `IntakePayload` from `lib/intake/types.ts` — same no-cross-dependency
   * rationale as `AuditorAnswerInput.groundingRows` above, and the same
   * precedent already set by this file's own `IntakeSnapshot.answers`. The
   * route layer (`app/api/chat/intake/route.ts`) is responsible for treating
   * this as a genuine (partial) `IntakePayload` shape when it recomputes
   * authoritative completeness via `lib/intake/completeness.ts`.
   */
  readonly partialPayload: Readonly<Record<string, unknown>>;
}

/**
 * Mirrors `agents/intake/instructions.md`'s `IntakeInterviewOutput` exactly
 * — no richer-shape-to-port-shape mapping step, same relationship as
 * `AuditorAnswerOutput` above. Runtime validator: `intakeInterviewOutputSchema`
 * in `./schemas`.
 */
export interface IntakeInterviewOutput {
  /** Partially-filled `IntakePayload` shape — nulls/empty arrays for anything not yet answered. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly gaps: readonly {
    readonly ruleId: string;
    readonly field: string;
    readonly level: "BLOCKING" | "REQUIRED-FOR-TIER" | "ADVISORY";
  }[];
  /** What the agent will ask next, in order; overlay questions verbatim. */
  readonly followUpQuestions: readonly string[];
}

/**
 * Capability port for single-shot agent assists (plan.md §4).
 * Adapters (eve or fallback) implement this; app code depends only on it.
 */
export interface AgentPort {
  /** Draft a domain review for a human to edit and sign. Never approves. */
  draftReview(
    input: DraftReviewInput,
    options?: InvokeOptions,
  ): Promise<PortResult<DraftReviewOutput>>;

  /** Advisory tier suggestion; deterministic app-code triage is authoritative. */
  triageAssist(
    input: TriageAssistInput,
    options?: InvokeOptions,
  ): Promise<PortResult<TriageAssistOutput>>;

  /** Flag missing/insufficient intake evidence for the requester. */
  checkCompleteness(
    input: CompletenessCheckInput,
    options?: InvokeOptions,
  ): Promise<PortResult<CompletenessCheckOutput>>;

  /**
   * Answer a natural-language audit question, grounded ONLY on the
   * structured query rows the caller supplies (agents/auditor/instructions.md
   * "Grounding rule"). Never approves, never uses general knowledge.
   */
  auditorAnswer(
    input: AuditorAnswerInput,
    options?: InvokeOptions,
  ): Promise<PortResult<AuditorAnswerOutput>>;

  /**
   * Continue a conversational intake interview by one turn: merge the
   * latest answer into the partial payload and decide what to ask next.
   * Never invents an answer to an unanswered field (agents/intake/
   * instructions.md "Never invent an answer") — the port's own `gaps` is
   * advisory only; the route recomputes authoritative gaps via
   * `lib/intake/completeness.ts`.
   */
  intakeInterview(
    input: IntakeInterviewInput,
    options?: InvokeOptions,
  ): Promise<PortResult<IntakeInterviewOutput>>;
}

/* -------------------------------------------------------------------------
 * WorkflowPort — fan-out, progress, pause/resume, cancel (plan.md §4)
 * ---------------------------------------------------------------------- */

/** Everything a workflow run can emit, as a discriminated union on `type`. */
export type WorkflowEvent<TItem, TItemResult> =
  | { type: "run-started"; runId: string; at: string }
  | { type: "item-started"; runId: string; item: TItem; at: string }
  | {
      type: "item-progress";
      runId: string;
      item: TItem;
      progress: ProgressEvent;
    }
  | {
      type: "item-completed";
      runId: string;
      item: TItem;
      result: TItemResult;
      at: string;
    }
  | {
      type: "item-failed";
      runId: string;
      item: TItem;
      error: PortFailure;
      at: string;
    }
  | {
      /**
       * The run reached a human gate (plan.md §4 pause/resume) and will not
       * progress until `WorkflowRunHandle.resume()` is called with a typed
       * payload. `promptKey` tells the UI which human input is needed.
       */
      type: "paused-for-human";
      runId: string;
      promptKey: string;
      message: string;
      at: string;
    }
  | { type: "resumed"; runId: string; at: string }
  | { type: "run-completed"; runId: string; at: string }
  | { type: "run-failed"; runId: string; error: PortFailure; at: string }
  | { type: "run-cancelled"; runId: string; reason?: string; at: string };

/**
 * Input for a fan-out run: one task applied over many items — the canonical
 * case is drafting reviews across the live governance domains in parallel
 * (plan.md §2 step 2, §9 P2).
 */
export interface FanOutInput<TItem, TTaskInput> {
  /** Adapter-registered task name, e.g. "draft-domain-reviews". */
  readonly task: string;
  /** One entry per parallel branch (e.g. one per governance domain). */
  readonly items: readonly TItem[];
  /** Shared input every branch receives alongside its item. */
  readonly shared: TTaskInput;
}

/** Aggregate outcome of a fan-out run: exactly one entry per input item. */
export interface FanOutResult<TItem, TItemResult> {
  readonly runId: string;
  readonly outcomes: ReadonlyArray<{
    readonly item: TItem;
    readonly result: PortResult<TItemResult>;
  }>;
}

/**
 * Live handle to a started run. The handle is how callers observe progress
 * (async-iterable event stream), await the final aggregate, resume a human
 * pause, or cancel — all four plan.md §4 workflow capabilities.
 *
 * Persistence note (hard rule 4): consuming these events NEVER mutates
 * authoritative state by itself. App code listens, then performs its own
 * transitions in Postgres.
 */
export interface WorkflowRunHandle<TItem, TItemResult, TResumePayload> {
  readonly runId: string;

  /**
   * Ordered event stream for this run. Iteration ends after a terminal
   * event (`run-completed` | `run-failed` | `run-cancelled`).
   */
  events(): AsyncIterable<WorkflowEvent<TItem, TItemResult>>;

  /** Resolves with the aggregate once the run reaches a terminal state. */
  result(): Promise<PortResult<FanOutResult<TItem, TItemResult>>>;

  /**
   * Provide the typed human input a `paused-for-human` gate is waiting on.
   * Rejects if the run is not currently paused.
   */
  resume(payload: TResumePayload): Promise<void>;

  /** Cooperatively cancel the run; branches settle as `cancelled`. */
  cancel(reason?: string): Promise<void>;
}

/**
 * Capability port for durable multi-step execution (plan.md §4).
 * Mocked fan-out is acceptable for the demo (plan.md §9 deferred polish);
 * the contract is identical either way, which is the point of the port.
 */
export interface WorkflowPort {
  /**
   * Start a fan-out run and return a handle immediately; work continues in
   * the background. `options.signal` aborts the whole run (equivalent to
   * `handle.cancel()`); `options.onProgress` receives item-level progress
   * in addition to the handle's event stream.
   */
  startFanOut<TItem, TTaskInput, TItemResult, TResumePayload = unknown>(
    input: FanOutInput<TItem, TTaskInput>,
    options?: InvokeOptions,
  ): Promise<
    PortResult<WorkflowRunHandle<TItem, TItemResult, TResumePayload>>
  >;
}
