import { ADDITIONAL_INTAKE_QUESTIONS, ADDITIONAL_ANSWER_MAX_LENGTH } from "@/lib/intake/additional-questions";
/**
 * Deterministic, offline `AgentPort` implementation (plan.md §8: "LLM calls
 * mocked" in tests/demo-safe paths). No network calls, no API key required.
 *
 * Every method/exported generator here must return byte-identical
 * (deep-equal) output for the same input across repeated calls — the only
 * real-time value anywhere is the `ProgressEvent.at` timestamp passed to the
 * `onProgress` side-channel callback, never part of a returned `PortResult`
 * value.
 */
import {
  mapReviewerDraftToPortOutput,
  type ReviewerDraftOutput,
} from "./schemas";
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
  PortResult,
} from "./ports";

/* -------------------------------------------------------------------------
 * Retention-gap check for deterministic draftReview
 * ---------------------------------------------------------------------- */

/**
 * Looks for the intake's data-retention answer under any of three key
 * shapes actually seen across the repo's fixtures/docs:
 *   - `answers.retentionIntent` (flat, matches IntakePayload.data.retentionIntent
 *     per lib/intake/completeness.test.ts)
 *   - `answers.dataRetention` (an alternate flat key some callers may use)
 *   - `answers.data.retentionIntent` (nested, mirroring the IntakePayload
 *     shape's `data` sub-object directly)
 * Missing, falsy, or empty-string values all count as "gap present" — an
 * intake that answered the question with an empty string is treated the
 * same as one that never answered it at all.
 */
function hasRetentionAnswer(answers: Readonly<Record<string, unknown>>): boolean {
  const flatA = answers["retentionIntent"];
  const flatB = answers["dataRetention"];
  const nested = answers["data"];
  const nestedRetention =
    nested && typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)["retentionIntent"]
      : undefined;

  return Boolean(flatA) || Boolean(flatB) || Boolean(nestedRetention);
}

/* -------------------------------------------------------------------------
 * Per-domain canned citation/control fixtures (docs/policies/INDEX.md)
 * ---------------------------------------------------------------------- */

interface DomainFixture {
  readonly policyId: string;
  readonly controlIds: readonly [string, string];
  readonly citations: readonly [string, string];
  /** Citation used specifically for the retention-gap evidence request. */
  readonly retentionCitation: string;
}

const DOMAIN_FIXTURES: Record<GovernanceDomain, DomainFixture> = {
  legal: {
    policyId: "MP-L v3",
    controlIds: ["L-01", "L-02"],
    citations: ["MP-L v3 §MP-L-2", "MP-L v3 §MP-L-3"],
    retentionCitation: "MP-L v3 §MP-L-4.2",
  },
  procurement: {
    policyId: "MP-P v2",
    controlIds: ["P-01", "P-02"],
    citations: ["MP-P v2 §MP-P-2", "MP-P v2 §MP-P-3"],
    retentionCitation: "MP-P v2 §MP-P-4.2",
  },
  "tech-architecture": {
    policyId: "MP-T v2",
    controlIds: ["T-01", "T-02"],
    citations: ["MP-T v2 §MP-T-2", "MP-T v2 §MP-T-3"],
    retentionCitation: "MP-T v2 §MP-T-4.3",
  },
  "responsible-ai": {
    policyId: "MP-R v4",
    controlIds: ["R-01", "R-02"],
    citations: ["MP-R v4 §MP-R-2", "MP-R v4 §MP-R-3"],
    retentionCitation: "MP-R v4 §MP-R-2.4",
  },
  security: {
    policyId: "MP-S v3",
    controlIds: ["S-01", "S-02"],
    citations: ["MP-S v3 §MP-S-2", "MP-S v3 §MP-S-3"],
    retentionCitation: "MP-S v3 §MP-S-3.2",
  },
  "privacy-hipaa": {
    policyId: "MP-H v3",
    controlIds: ["H-01", "H-02"],
    citations: ["MP-H v3 §MP-H-2", "MP-H v3 §MP-H-3"],
    retentionCitation: "MP-H v3 §MP-H-2.5",
  },
  "clinical-safety": {
    policyId: "MP-C v3",
    controlIds: ["C-01", "C-02"],
    citations: ["MP-C v3 §MP-C-2", "MP-C v3 §MP-C-3"],
    retentionCitation: "MP-C v3 §MP-C-4.3",
  },
  "data-governance": {
    policyId: "MP-D v2",
    controlIds: ["D-01", "D-02"],
    citations: ["MP-D v2 §MP-D-2", "MP-D v2 §MP-D-3"],
    retentionCitation: "MP-D v2 §MP-D-3.3",
  },
};

/**
 * Builds a plausible canned rich reviewer draft (`ReviewerDraftOutput`) for
 * the given domain, deterministic from `input`. Exported directly (rather
 * than only reachable through `AgentPort.draftReview`) so tests can assert
 * on `citations`/`evidenceRequests` contents before port-shape mapping.
 */
export function buildMockReviewerDraft(
  input: DraftReviewInput,
): ReviewerDraftOutput {
  const fixture = DOMAIN_FIXTURES[input.domain];
  const [controlA, controlB] = fixture.controlIds;
  const [citationA, citationB] = fixture.citations;
  const gapPresent = !hasRetentionAnswer(input.intake.answers);

  const citations = gapPresent
    ? [citationA, citationB, fixture.retentionCitation]
    : [citationA, citationB];

  const evidenceRequests = gapPresent
    ? [
        {
          controlId: controlA,
          description: `Data-retention answer is missing from the intake — cannot confirm ${controlA} per ${fixture.retentionCitation}.`,
        },
        {
          controlId: controlB,
          description: `Retention/disposal posture for ${controlB} cannot be reconciled until the retention answer is supplied.`,
        },
      ]
    : [];

  const assessmentMd = gapPresent
    ? [
        `- **${controlA}**: control text reviewed per ${citationA}; artifact posture otherwise plausible for this profile.`,
        `- **${controlB}**: control text reviewed per ${citationB}; artifact posture otherwise plausible for this profile.`,
        `- **Data retention**: the intake's retention answer is missing, which blocks sign-off per ${fixture.retentionCitation} — this is a routine, well-understood finding, not a surprise.`,
      ].join("\n")
    : [
        `- **${controlA}**: requirements satisfied per ${citationA}.`,
        `- **${controlB}**: requirements satisfied per ${citationB}.`,
        `- **Data retention**: the intake's retention answer is present and consistent with this domain's requirements.`,
      ].join("\n");

  return {
    assessmentMd: `Synthetic data — demo. Canned policy references; document contents were not inspected.\n\n${assessmentMd}`,
    citations,
    evidenceRequests,
    recommendation: gapPresent ? "return-with-gaps" : "ready-for-signature",
    suggestedConditions: [],
    confidenceNotes: gapPresent
      ? "Retention gap is the only open item; otherwise no ambiguous policy language identified."
      : "No open concerns identified from the supplied intake and control catalog rows.",
  };
}

/* -------------------------------------------------------------------------
 * Deterministic latency
 * ---------------------------------------------------------------------- */

/**
 * Stable string hash (djb2 variant) used only to derive a small deterministic
 * delay per domain — never used for anything security-sensitive.
 */
function stableHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Derives a small deterministic "latency" in the 10-30ms range from the
 * domain name: `10 + (stableHash(domain) % 21)`. This exists purely to give
 * `draftReview` a non-instant, but still fast and fully deterministic, feel
 * for demo/UI-streaming purposes — it never affects the returned value.
 */
function deterministicDelayMs(domain: GovernanceDomain): number {
  return 10 + (stableHash(domain) % 21);
}

/** Resolves after `ms`, or rejects-as-aborted if `signal` fires first. */
function delayOrAbort(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<"completed" | "aborted"> {
  if (signal?.aborted) {
    return Promise.resolve("aborted");
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve("completed");
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve("aborted");
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/* -------------------------------------------------------------------------
 * Auditor agent (M2) — agents/auditor/instructions.md
 * ---------------------------------------------------------------------- */

/** Verbatim refusal text, agents/auditor/instructions.md "Refusal behavior". */
const AUDITOR_REFUSAL_TEXT =
  "That's not in the governance record I have access to for this query.";

/**
 * Extracts a stable citation label for a single grounding row. Tries, in
 * order: an `eventTs`-like field, then a `ts`-like field, then falls back to
 * a stable per-row index label — never fabricates a value that wasn't on
 * the row itself (agents/auditor/instructions.md's absolute grounding rule).
 */
function citationForRow(row: Readonly<Record<string, unknown>>, index: number): string {
  const eventTs = row["eventTs"];
  if (typeof eventTs === "string" && eventTs.length > 0) return eventTs;
  const ts = row["ts"];
  if (typeof ts === "string" && ts.length > 0) return ts;
  return `row-${index}`;
}

/**
 * Renders one grounding row as a single Markdown bullet, interpolating ONLY
 * literal field values already present on the row (never adding independent
 * prose claims) — the mechanism that satisfies the "never invent a fact"
 * grounding rule at the mock-adapter layer. Fields are rendered in a fixed,
 * deterministic order; absent fields are simply skipped (not rendered as
 * "unknown" or similar, which would itself be an invented claim about
 * absence rather than a citation of presence).
 */
function renderRowBullet(row: Readonly<Record<string, unknown>>, citation: string): string {
  const parts: string[] = [];
  const title = row["title"];
  if (typeof title === "string" && title.length > 0) parts.push(title);
  const slug = row["slug"];
  if (typeof slug === "string" && slug.length > 0) parts.push(`(${slug})`);
  const approver = row["approver"];
  if (typeof approver === "string" && approver.length > 0) parts.push(`— approver: ${approver}`);
  const actor = row["actor"];
  if (typeof actor === "string" && actor.length > 0) parts.push(`— actor: ${actor}`);
  const action = row["action"];
  if (typeof action === "string" && action.length > 0) parts.push(`(${action})`);
  const detail = row["detail"];
  if (typeof detail === "string" && detail.length > 0) parts.push(`— ${detail}`);
  const state = row["state"];
  if (typeof state === "string" && state.length > 0) parts.push(`[state: ${state}]`);
  if (parts.length === 0) {
    // No recognized field present on this row — cite it by its stable label
    // alone rather than rendering nothing (still not an invented fact: the
    // citation label itself is derived from the row, per citationForRow).
    return `- (${citation})`;
  }
  return `- ${parts.join(" ")} (event ts ${citation})`;
}

function buildAuditorAnswerOutput(input: AuditorAnswerInput): AuditorAnswerOutput {
  if (input.groundingRows.length === 0) {
    return {
      answerMd: AUDITOR_REFUSAL_TEXT,
      citedEvents: [],
      queryUsed: input.queryUsed,
    };
  }

  const citations = input.groundingRows.map((row, i) => citationForRow(row, i));
  const bullets = input.groundingRows.map((row, i) => renderRowBullet(row, citations[i]!));

  return {
    answerMd: bullets.join("\n"),
    citedEvents: citations,
    queryUsed: input.queryUsed,
  };
}

/* -------------------------------------------------------------------------
 * Intake interview agent (M2) — agents/intake/instructions.md
 * ---------------------------------------------------------------------- */

/**
 * The six overlay questions, asked verbatim in this exact fixed order
 * (agents/intake/instructions.md "The overlay questions are asked
 * verbatim") — copied character-for-character from that file, including
 * each question's helper line. `field` matches `IntakeOverlay`
 * (lib/intake/types.ts) key names.
 */
const OVERLAY_QUESTIONS: readonly {
  readonly field: string;
  readonly text: string;
}[] = [
  {
    field: "touchesPHI",
    text:
      "Does it access PHI? Determines Privacy/HIPAA control applicability (H-01, H-02) and drives the PHI-category/retention questions above.",
  },
  {
    field: "memberFacing",
    text:
      "Do members interact with or receive its output directly? Member-facing systems carry higher individual-impact and consumer-protection exposure, and add Legal review (L-02).",
  },
  {
    field: "careCoverageInfluence",
    text:
      "Does it influence care or coverage decisions? The single strongest driver of tier — care/coverage influence without a human check is Critical (tier rule 1).",
  },
  {
    field: "vendorHosted",
    text:
      "Is the model vendor-hosted? Vendor hosting triggers Procurement and Legal control requirements (contract addendum, VRA, data-residency attestation).",
  },
  {
    field: "humanInTheLoop",
    text:
      "Does a qualified human review each output before it takes effect? A human-in-the-loop check downgrades otherwise-Critical care/coverage cases to High (tier rule 2) — it is a mitigating control, not a formality.",
  },
  {
    field: "individualImpact",
    text:
      "Does it affect individuals' opportunities, rights, or services (members, providers, or employees)? Individual-impact combined with member-facing is an independent High-tier trigger, and feeds Medium-tier default even absent other flags.",
  },
];

const CLOSING_ACKNOWLEDGMENT =
  "All required overlay questions are answered.";

/**
 * Deterministic, case-insensitive keyword match: does `content` unambiguously
 * answer a yes/no overlay question? Returns `true`/`false` only for a clear
 * match, `null` when ambiguous or absent — never guesses (agents/intake/
 * instructions.md "Never invent an answer": an unclear answer must stay
 * `null`, not be coerced to `false`).
 */
function matchYesNo(content: string): boolean | null {
  const normalized = content.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const hasYes = /\byes\b|\byeah\b|\byep\b/.test(normalized);
  const hasNo = /\bno\b|\bnope\b|\bnot really\b|\bdoesn't\b|\bdon't\b/.test(normalized);

  if (hasYes && !hasNo) return true;
  if (hasNo && !hasYes) return false;
  // Both or neither matched (e.g. "not sure", "maybe") — ambiguous.
  return null;
}

function getOverlay(
  partialPayload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const overlay = partialPayload["overlay"];
  if (overlay && typeof overlay === "object") {
    return { ...(overlay as Record<string, unknown>) };
  }
  return {};
}

/** First overlay question (in fixed order) whose field is still null/undefined. */
function nextPendingOverlayQuestion(
  overlay: Readonly<Record<string, unknown>>,
): (typeof OVERLAY_QUESTIONS)[number] | null {
  for (const q of OVERLAY_QUESTIONS) {
    const value = overlay[q.field];
    if (value === null || value === undefined) return q;
  }
  return null;
}

function lastUserMessage(
  conversation: IntakeInterviewInput["conversation"],
): string | null {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i]!.role === "user") return conversation[i]!.content;
  }
  return null;
}

/**
 * Advisory-only gaps derived from which overlay fields are still null — the
 * ROUTE layer (app/api/chat/intake/route.ts) recomputes authoritative gaps
 * via `lib/intake/completeness.ts`'s `evaluateCompleteness` once the port's
 * returned payload is merged; this simplified list exists only so the port's
 * own output shape is non-trivial without duplicating that full rules
 * engine here (documented simplification, task brief Task 3).
 */
function buildMockIntakeGaps(
  overlay: Readonly<Record<string, unknown>>,
): IntakeInterviewOutput["gaps"] {
  return OVERLAY_QUESTIONS.filter((q) => {
    const value = overlay[q.field];
    return value === null || value === undefined;
  }).map((q) => ({
    ruleId: `BLK-overlay-${q.field}`,
    field: `overlay.${q.field}`,
    level: "BLOCKING" as const,
  }));
}

const OPTIONAL_QUESTIONS = Object.entries(ADDITIONAL_INTAKE_QUESTIONS).flatMap(([section, questions]) =>
  questions.map((question) => ({ section, ...question })),
);

/** The offline interviewer only copies an answer to the question it just asked. */
function optionalIntakeFollowUp(input: IntakeInterviewInput, payload: Record<string, unknown>): string {
  const lastTurn = input.conversation.at(-1);
  const lastAssistant = input.conversation.findLast((turn) => turn.role === "assistant");
  const answered = OPTIONAL_QUESTIONS.find((q) => lastAssistant?.content.includes(q.question));
  if (answered && lastTurn?.role === "user") {
    const answer = lastTurn.content.trim();
    if (/^(?:please\s+)?(?:review(?: and submit)?|submit|continue(?: to review)?)[.!]?$/i.test(answer)) {
      return "Your answers are unchanged. Use Review and submit to check them and submit when ready.";
    }
    if (answer.length > ADDITIONAL_ANSWER_MAX_LENGTH) {
      return `Please keep this answer to ${ADDITIONAL_ANSWER_MAX_LENGTH} characters or fewer. ${answered.question} You can also say skip.`;
    }
    const unknown = /^(?:skip|unknown|not sure|i(?: don't| do not) know|prefer not to answer)[.!]?$/i.test(answer);
    const current = payload[answered.section];
    payload[answered.section] = {
      ...(current && typeof current === "object" ? current : {}),
      [answered.key]: unknown || answer === "" ? null : answer,
    };
  }
  const next = OPTIONAL_QUESTIONS.find((q) => {
    const section = payload[q.section] as Record<string, unknown> | undefined;
    const answer = section?.[q.key];
    const hasAnswer = typeof answer === "string" && answer.trim().length > 0;
    const alreadyAsked = input.conversation.some((turn) => turn.role === "assistant" && turn.content.includes(q.question));
    return !hasAnswer && !alreadyAsked;
  });
  return next ? `Optional: ${next.question} You can say skip, or use Review and submit when ready.` : CLOSING_ACKNOWLEDGMENT;
}

function buildIntakeInterviewOutput(
  input: IntakeInterviewInput,
): IntakeInterviewOutput {
  const overlay = getOverlay(input.partialPayload);
  const pendingBeforeAnswer = nextPendingOverlayQuestion(overlay);

  // Merge: if there's a currently-pending overlay question and the last user
  // message unambiguously answers it, set that field. Never touches any
  // other field, and never coerces an ambiguous/absent answer to false.
  if (pendingBeforeAnswer) {
    const message = lastUserMessage(input.conversation);
    const answer = message === null ? null : matchYesNo(message);
    if (answer !== null) {
      overlay[pendingBeforeAnswer.field] = answer;
    }
  }

  const payload: Record<string, unknown> = {
    ...input.partialPayload,
    overlay,
  };

  const pendingAfterAnswer = nextPendingOverlayQuestion(overlay);
  const followUpQuestions = pendingAfterAnswer
    ? [pendingAfterAnswer.text]
    : [optionalIntakeFollowUp(input, payload)];

  return {
    payload,
    gaps: buildMockIntakeGaps(overlay),
    followUpQuestions,
  };
}

/* -------------------------------------------------------------------------
 * AgentPort factory
 * ---------------------------------------------------------------------- */

/** Deterministic, fully offline `AgentPort` implementation. */
export function createMockAgentPort(): AgentPort {
  return {
    async draftReview(
      input: DraftReviewInput,
      options?: InvokeOptions,
    ): Promise<PortResult<DraftReviewOutput>> {
      const invocationId = `mock-draft-${input.reviewCycleId}-${input.domain}`;

      options?.onProgress?.({
        invocationId,
        stage: "drafting",
        message: `Drafting ${input.domain} review`,
        at: new Date().toISOString(),
      });

      const delayMs = deterministicDelayMs(input.domain);
      const timeoutMs = options?.timeoutMs;

      // ports.ts InvokeOptions.timeoutMs: "Hard deadline; adapters map
      // overruns to the `timeout` failure." When the deadline is shorter
      // than this domain's simulated latency, the invocation overruns: we
      // wait out the deadline itself (so the overrun is still observable as
      // elapsed time, and a racing user abort still wins as `cancelled`),
      // then surface the timeout failure.
      if (timeoutMs !== undefined && timeoutMs < delayMs) {
        const startedAt = Date.now();
        const outcome = await delayOrAbort(timeoutMs, options?.signal);
        if (outcome === "aborted") {
          return { ok: false, error: { kind: "cancelled" } };
        }
        return {
          ok: false,
          error: {
            kind: "timeout",
            message: `draftReview exceeded its ${timeoutMs}ms deadline (simulated ${input.domain} latency is ${delayMs}ms).`,
            elapsedMs: Date.now() - startedAt,
          },
        };
      }

      const outcome = await delayOrAbort(delayMs, options?.signal);
      if (outcome === "aborted") {
        return { ok: false, error: { kind: "cancelled" } };
      }

      const rich = buildMockReviewerDraft(input);
      const value = {
        ...mapReviewerDraftToPortOutput(input.domain, rich),
        generationMetadata: { adapter: "mock", synthetic: true, fixtureVersion: "reviewer-v1" },
      };
      return { ok: true, value };
    },

    async auditorAnswer(
      input: AuditorAnswerInput,
      options?: InvokeOptions,
    ): Promise<PortResult<AuditorAnswerOutput>> {
      options?.onProgress?.({
        invocationId: `mock-auditor-${input.queryUsed}`,
        stage: "answering",
        at: new Date().toISOString(),
      });

      if (options?.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled" } };
      }

      return { ok: true, value: buildAuditorAnswerOutput(input) };
    },

    async intakeInterview(
      input: IntakeInterviewInput,
      options?: InvokeOptions,
    ): Promise<PortResult<IntakeInterviewOutput>> {
      options?.onProgress?.({
        invocationId: `mock-intake-${input.conversation.length}`,
        stage: "interviewing",
        at: new Date().toISOString(),
      });

      if (options?.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled" } };
      }

      return { ok: true, value: buildIntakeInterviewOutput(input) };
    },
  };
}
