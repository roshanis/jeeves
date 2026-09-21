/**
 * Application-owned contracts for AI assistance. Adapters return drafts;
 * application code and Postgres retain all authoritative state transitions.
 * Agents never approve, sign, or decide.
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
      /** Cancelled via AbortSignal. */
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
 * Progress notifications use the optional callback.
 */
export interface InvokeOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: ProgressEvent) => void;
  /** Hard deadline; adapters map overruns to the `timeout` failure. */
  readonly timeoutMs?: number;
}

/* -------------------------------------------------------------------------
 * AgentPort — review drafting, auditor answers and intake interviews
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
  /** Policy anchors, separate from descriptions of missing evidence. */
  readonly citations: readonly string[];
  /** Includes control-linked evidence/conditions and confidence notes for the human editor. */
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
 * Capabilities used by application callers.
 * Adapters implement this contract; app code owns policy and persistence.
 */
export interface AgentPort {
  /** Draft a domain review for a human to edit and sign. Never approves. */
  draftReview(
    input: DraftReviewInput,
    options?: InvokeOptions,
  ): Promise<PortResult<DraftReviewOutput>>;

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
