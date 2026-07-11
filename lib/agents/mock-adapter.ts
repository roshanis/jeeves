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
  type OpsMonitorIncidentOutput,
  type ReviewerDraftOutput,
  type TriageRationaleOutput,
} from "./schemas";
import type {
  AgentPort,
  CompletenessCheckInput,
  CompletenessCheckOutput,
  DraftReviewInput,
  DraftReviewOutput,
  GovernanceDomain,
  InvokeOptions,
  PortResult,
  TriageAssistInput,
  TriageAssistOutput,
} from "./ports";

/* -------------------------------------------------------------------------
 * Shared retention-gap check (draftReview + checkCompleteness)
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
    assessmentMd,
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
 * Triage rationale (rich + port-shape)
 * ---------------------------------------------------------------------- */

/**
 * Deterministic rich `TriageRationaleOutput` synthesized from
 * `input.intake.answers`. This is the fuller shape documented in
 * agents/triage/instructions.md; `AgentPort.triageAssist` (below) returns
 * the simpler port shape (`TriageAssistOutput`), so this is exported
 * separately for future/direct testing use per the task brief.
 */
export function generateMockTriageRationale(
  input: TriageAssistInput,
): TriageRationaleOutput {
  const answers = input.intake.answers;
  const phi = Boolean(answers["phi"]);
  const memberFacing = Boolean(answers["memberFacing"]);
  const careCoverageInfluence = Boolean(answers["careCoverageInfluence"]);
  const humanInLoop = Boolean(answers["humanInLoop"]);

  const flagExplanations: TriageRationaleOutput["flagExplanations"] = [];
  if (careCoverageInfluence) {
    flagExplanations.push({
      flag: "careCoverageInfluence",
      answer: "Yes",
      why: "Care/coverage-influencing initiatives carry the highest routing weight in the tier rules.",
    });
  }
  if (phi) {
    flagExplanations.push({
      flag: "phi",
      answer: "Yes",
      why: "PHI-touching initiatives are routed through Privacy/HIPAA regardless of other flags.",
    });
  }
  if (memberFacing) {
    flagExplanations.push({
      flag: "memberFacing",
      answer: "Yes",
      why: "Member-facing initiatives add Legal's marketing-claims review to the required domains.",
    });
  }
  if (careCoverageInfluence && !humanInLoop) {
    flagExplanations.push({
      flag: "humanInLoop",
      answer: "No",
      why: "No qualified human reviews the output before it reaches a coverage step — the highest-risk pattern.",
    });
  }

  const rationaleMd =
    careCoverageInfluence && !humanInLoop
      ? "This initiative influences a coverage decision and no qualified human reviews its output before that decision takes effect — the highest-risk combination in the review model, routed as Critical tier."
      : phi
        ? "This initiative touches PHI, which routes it through Privacy/HIPAA and drives at least a High tier."
        : "This initiative's overlay-question answers place it in a lower-risk routing tier per the fired rule.";

  return { rationaleMd, flagExplanations };
}

function buildTriageAssistOutput(
  input: TriageAssistInput,
): TriageAssistOutput {
  const answers = input.intake.answers;
  const phi = Boolean(answers["phi"]);
  const careCoverageInfluence = Boolean(answers["careCoverageInfluence"]);
  const humanInLoop = Boolean(answers["humanInLoop"]);
  const memberFacing = Boolean(answers["memberFacing"]);
  const individualImpact = Boolean(answers["individualImpact"]);

  const signals: string[] = [];
  if (phi) signals.push("phi");
  if (memberFacing) signals.push("member-facing");
  if (careCoverageInfluence) signals.push("coverage-influence");
  if (individualImpact) signals.push("individual-impact");

  let suggestedTier: TriageAssistOutput["suggestedTier"];
  let rationale: string;
  if (careCoverageInfluence && !humanInLoop) {
    suggestedTier = "critical";
    rationale =
      "Care/coverage influence without a human-in-the-loop checkpoint is the highest-risk pattern.";
  } else if (careCoverageInfluence || phi) {
    suggestedTier = "high";
    rationale = careCoverageInfluence
      ? "Care/coverage influence with a human-in-the-loop checkpoint present."
      : "PHI-touching initiative.";
  } else if (memberFacing || individualImpact) {
    suggestedTier = "medium";
    rationale = "Member-facing or individual-impact flag present, no higher-priority rule fired.";
  } else {
    suggestedTier = "low";
    rationale = "No elevated-risk overlay flags present.";
  }

  return { suggestedTier, rationale, signals };
}

/* -------------------------------------------------------------------------
 * Completeness check
 * ---------------------------------------------------------------------- */

function buildCompletenessCheckOutput(
  input: CompletenessCheckInput,
): CompletenessCheckOutput {
  const answers = input.intake.answers;
  const gapPresent = !hasRetentionAnswer(answers);

  return {
    complete: !gapPresent,
    missingFields: gapPresent ? ["retentionIntent"] : [],
    notes: gapPresent
      ? {
          retentionIntent:
            "Specify the intended data-retention period before this intake can be treated as complete.",
        }
      : {},
  };
}

/* -------------------------------------------------------------------------
 * Ops-monitor incident summary (not wired to any AgentPort method)
 * ---------------------------------------------------------------------- */

export interface MockIncidentPayload {
  readonly controlId: string;
  readonly initiativeId: string;
  readonly domain: GovernanceDomain;
}

/**
 * Deterministic canned incident-summary generator matching
 * `OpsMonitorIncidentOutput` (agents/ops-monitor/instructions.md). Not
 * wired to any `AgentPort` method — `ops-monitor` has no port method today
 * (see lib/agents/schemas.ts's note on `opsMonitorIncidentOutputSchema`).
 */
export function generateMockIncidentSummary(
  payload: MockIncidentPayload,
): OpsMonitorIncidentOutput {
  const fixture = DOMAIN_FIXTURES[payload.domain];
  return {
    incidentSummaryMd: `Control ${payload.controlId} breached its threshold for initiative ${payload.initiativeId}. Deployment paused and a reassessment ReviewCycle opened automatically.`,
    suggestedScope: [payload.domain, "responsible-ai"].filter(
      (d, i, arr) => arr.indexOf(d) === i,
    ) as GovernanceDomain[],
    severityNote: `Breach recorded against ${fixture.policyId}-adjacent controls (${fixture.controlIds.join(", ")}); severity reflects the initiative's existing tier/profile, not a newly invented scale.`,
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
      const value = mapReviewerDraftToPortOutput(input.domain, rich);
      return { ok: true, value };
    },

    async triageAssist(
      input: TriageAssistInput,
      options?: InvokeOptions,
    ): Promise<PortResult<TriageAssistOutput>> {
      options?.onProgress?.({
        invocationId: `mock-triage-${input.intake.intakeVersionId}`,
        stage: "explaining",
        at: new Date().toISOString(),
      });

      if (options?.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled" } };
      }

      return { ok: true, value: buildTriageAssistOutput(input) };
    },

    async checkCompleteness(
      input: CompletenessCheckInput,
      options?: InvokeOptions,
    ): Promise<PortResult<CompletenessCheckOutput>> {
      options?.onProgress?.({
        invocationId: `mock-completeness-${input.intake.intakeVersionId}`,
        stage: "checking",
        at: new Date().toISOString(),
      });

      if (options?.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled" } };
      }

      return { ok: true, value: buildCompletenessCheckOutput(input) };
    },
  };
}
