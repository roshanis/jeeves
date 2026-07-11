import { describe, expect, it } from "vitest";
import {
  buildMockReviewerDraft,
  createMockAgentPort,
  generateMockIncidentSummary,
  generateMockTriageRationale,
} from "@/lib/agents/mock-adapter";
import type {
  AuditorAnswerInput,
  CompletenessCheckInput,
  DraftReviewInput,
  GovernanceDomain,
  IntakeInterviewInput,
  IntakeSnapshot,
  TriageAssistInput,
} from "@/lib/agents/ports";

/** Real citation anchors per domain (docs/policies/INDEX.md), keyed by
 * GovernanceDomain, used to assert buildMockReviewerDraft cites real
 * section anchors for every domain — not invented or cross-domain ones. */
const REAL_ANCHOR_PATTERN: Record<GovernanceDomain, RegExp> = {
  legal: /MP-L v3 §MP-L-(2|3)/,
  procurement: /MP-P v2 §MP-P-(2|3)/,
  "tech-architecture": /MP-T v2 §MP-T-(2|3)/,
  "responsible-ai": /MP-R v4 §MP-R-(2|3)/,
  security: /MP-S v3 §MP-S-(2|3)/,
  "privacy-hipaa": /MP-H v3 §MP-H-(2|3)/,
  "clinical-safety": /MP-C v3 §MP-C-(2|3)/,
  "data-governance": /MP-D v2 §MP-D-(2|3)/,
};

const ALL_DOMAINS: GovernanceDomain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

function intake(
  answers: Readonly<Record<string, unknown>> = {},
): IntakeSnapshot {
  return {
    initiativeId: "init-1",
    intakeVersionId: "iv-1",
    answers,
  };
}

function draftInput(
  domain: GovernanceDomain,
  answers: Readonly<Record<string, unknown>> = {},
): DraftReviewInput {
  return {
    reviewCycleId: "rc-1",
    domain,
    intake: intake(answers),
  };
}

describe("buildMockReviewerDraft — citation fixtures per domain", () => {
  for (const domain of ALL_DOMAINS) {
    it(`${domain}: citations include a real anchor for this domain's controls`, () => {
      const rich = buildMockReviewerDraft(
        draftInput(domain, { retentionIntent: "<=1 year" }),
      );
      const pattern = REAL_ANCHOR_PATTERN[domain];
      expect(rich.citations.some((c) => pattern.test(c))).toBe(true);
      expect(rich.citations.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("recommends return-with-gaps when retention-gap key is absent from intake.answers", () => {
    const rich = buildMockReviewerDraft(draftInput("privacy-hipaa", {}));
    expect(rich.recommendation).toBe("return-with-gaps");
    expect(rich.evidenceRequests.length).toBeGreaterThan(0);
  });

  it("privacy-hipaa retention gap cites MP-H v3 §MP-H-2.5 specifically", () => {
    const rich = buildMockReviewerDraft(draftInput("privacy-hipaa", {}));
    const allText = [
      ...rich.evidenceRequests.map((r) => r.description),
      ...rich.citations,
    ].join(" ");
    expect(allText).toMatch(/MP-H v3 §MP-H-2\.5/);
  });

  it("recommends ready-for-signature when retentionIntent is present and truthy", () => {
    const rich = buildMockReviewerDraft(
      draftInput("legal", { retentionIntent: "<=1 year" }),
    );
    expect(rich.recommendation).toBe("ready-for-signature");
  });

  it("treats a falsy/empty-string retentionIntent as a gap", () => {
    const rich = buildMockReviewerDraft(
      draftInput("legal", { retentionIntent: "" }),
    );
    expect(rich.recommendation).toBe("return-with-gaps");
  });

  it("also recognizes dataRetention and nested data.retentionIntent as satisfying the gap check", () => {
    const viaDataRetention = buildMockReviewerDraft(
      draftInput("security", { dataRetention: "<=1 year" }),
    );
    expect(viaDataRetention.recommendation).toBe("ready-for-signature");

    const viaNested = buildMockReviewerDraft(
      draftInput("security", { data: { retentionIntent: "<=1 year" } }),
    );
    expect(viaNested.recommendation).toBe("ready-for-signature");
  });
});

describe("createMockAgentPort — determinism and AgentPort contract", () => {
  const port = createMockAgentPort();

  it("draftReview: same input -> deep-equal output across 2 calls", async () => {
    const input = draftInput("privacy-hipaa", { retentionIntent: "<=1 year" });
    const first = await port.draftReview(input);
    const second = await port.draftReview(input);
    expect(first).toEqual(second);
  });

  it("triageAssist: same input -> deep-equal output across 2 calls", async () => {
    const input: TriageAssistInput = {
      intake: intake({ phi: true, careCoverageInfluence: true }),
    };
    const first = await port.triageAssist(input);
    const second = await port.triageAssist(input);
    expect(first).toEqual(second);
  });

  it("checkCompleteness: same input -> deep-equal output across 2 calls", async () => {
    const input: CompletenessCheckInput = {
      intake: intake({ retentionIntent: "<=1 year" }),
    };
    const first = await port.checkCompleteness(input);
    const second = await port.checkCompleteness(input);
    expect(first).toEqual(second);
  });

  it("draftReview never emits an approval — recommendation matches /^recommend-/", async () => {
    const result = await port.draftReview(draftInput("clinical-safety"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recommendation).toMatch(/^recommend-/);
    }
  });

  it("draftReview fires onProgress at least once", async () => {
    const events: string[] = [];
    await port.draftReview(draftInput("security", { retentionIntent: "x" }), {
      onProgress: (event) => events.push(event.stage),
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it("draftReview resolves cancelled when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await port.draftReview(draftInput("legal"), {
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("draftReview resolves cancelled when signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const promise = port.draftReview(
      draftInput("tech-architecture", { retentionIntent: "x" }),
      { signal: controller.signal },
    );
    controller.abort();
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("checkCompleteness flags missing retention answer", async () => {
    const result = await port.checkCompleteness({ intake: intake({}) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.complete).toBe(false);
      expect(result.value.missingFields).toContain("retentionIntent");
    }
  });

  it("checkCompleteness reports complete when retention answer is present", async () => {
    const result = await port.checkCompleteness({
      intake: intake({ retentionIntent: "<=1 year" }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.complete).toBe(true);
      expect(result.value.missingFields).toEqual([]);
    }
  });
});

describe("createMockAgentPort — timeoutMs deadline (ports.ts InvokeOptions)", () => {
  const port = createMockAgentPort();

  it("draftReview maps a timeoutMs shorter than the simulated latency to a timeout failure", async () => {
    // Every domain's deterministic latency is >= 10ms, so a 1ms deadline
    // always overruns.
    const result = await port.draftReview(
      draftInput("legal", { retentionIntent: "<=1 year" }),
      { timeoutMs: 1 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      if (result.error.kind === "timeout") {
        expect(result.error.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("draftReview succeeds when timeoutMs comfortably exceeds the simulated latency", async () => {
    const result = await port.draftReview(
      draftInput("legal", { retentionIntent: "<=1 year" }),
      { timeoutMs: 5_000 },
    );
    expect(result.ok).toBe(true);
  });

  it("user abort maps to cancelled (not timeout) when a deadline is also set", async () => {
    const controller = new AbortController();
    const promise = port.draftReview(
      draftInput("legal", { retentionIntent: "<=1 year" }),
      { timeoutMs: 5_000, signal: controller.signal },
    );
    controller.abort();
    expect(await promise).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
  });
});

describe("generateMockTriageRationale — rich shape", () => {
  it("is deterministic for the same input", () => {
    const input: TriageAssistInput = {
      intake: intake({ phi: true, careCoverageInfluence: true }),
    };
    expect(generateMockTriageRationale(input)).toEqual(
      generateMockTriageRationale(input),
    );
  });

  it("produces rationaleMd and flagExplanations", () => {
    const result = generateMockTriageRationale({
      intake: intake({ phi: true }),
    });
    expect(typeof result.rationaleMd).toBe("string");
    expect(result.rationaleMd.length).toBeGreaterThan(0);
    expect(Array.isArray(result.flagExplanations)).toBe(true);
  });
});

describe("generateMockIncidentSummary — deterministic canned generator", () => {
  it("is deterministic for the same input", () => {
    const payload = {
      controlId: "Q-01",
      initiativeId: "init-1",
      domain: "clinical-safety" as GovernanceDomain,
    };
    expect(generateMockIncidentSummary(payload)).toEqual(
      generateMockIncidentSummary(payload),
    );
  });

  it("produces the OpsMonitorIncidentOutput shape", () => {
    const result = generateMockIncidentSummary({
      controlId: "Q-01",
      initiativeId: "init-1",
      domain: "clinical-safety" as GovernanceDomain,
    });
    expect(typeof result.incidentSummaryMd).toBe("string");
    expect(Array.isArray(result.suggestedScope)).toBe(true);
    expect(typeof result.severityNote).toBe("string");
  });
});

/* -------------------------------------------------------------------------
 * auditorAnswer (M2)
 * ---------------------------------------------------------------------- */

const REFUSAL_TEXT =
  "That's not in the governance record I have access to for this query.";

function auditorInput(
  overrides: Partial<AuditorAnswerInput> = {},
): AuditorAnswerInput {
  return {
    question: "Which initiatives are member-facing and touch PHI?",
    groundingRows: [],
    queryUsed: "member-facing-phi",
    ...overrides,
  };
}

describe("createMockAgentPort — auditorAnswer", () => {
  const port = createMockAgentPort();

  it("refuses verbatim with empty citedEvents when groundingRows is empty", async () => {
    const result = await port.auditorAnswer(auditorInput({ groundingRows: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.answerMd).toBe(REFUSAL_TEXT);
      expect(result.value.citedEvents).toEqual([]);
      expect(result.value.queryUsed).toBe("member-facing-phi");
    }
  });

  it("echoes queryUsed verbatim from the input on refusal", async () => {
    const result = await port.auditorAnswer(
      auditorInput({ groundingRows: [], queryUsed: "ad-hoc: nothing matched" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queryUsed).toBe("ad-hoc: nothing matched");
    }
  });

  it("cites exactly the eventTs values present on supplied rows, nothing else", async () => {
    const rows = [
      { slug: "member-chat-copilot", title: "Member Chat Copilot", eventTs: "2026-07-15T14:02:00Z" },
      { slug: "prior-auth-summarizer", title: "Prior-Auth Summarizer", eventTs: "2026-06-01T09:00:00Z" },
    ];
    const result = await port.auditorAnswer(auditorInput({ groundingRows: rows }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.citedEvents).toEqual([
        "2026-07-15T14:02:00Z",
        "2026-06-01T09:00:00Z",
      ]);
      expect(result.value.citedEvents.length).toBe(rows.length);
    }
  });

  it("falls back to a ts field when eventTs is absent", async () => {
    const rows = [{ ts: "2026-05-01T00:00:00Z", actor: "Ray Chen", action: "control_threshold_changed" }];
    const result = await port.auditorAnswer(auditorInput({ groundingRows: rows }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.citedEvents).toEqual(["2026-05-01T00:00:00Z"]);
    }
  });

  it("falls back to a stable per-row index citation when no ts/eventTs field is present", async () => {
    const rows = [{ foo: "bar" }, { foo: "baz" }];
    const result = await port.auditorAnswer(auditorInput({ groundingRows: rows }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.citedEvents).toHaveLength(2);
      // Deterministic and distinguishable per row, not the literal row content.
      expect(result.value.citedEvents[0]).not.toBe(result.value.citedEvents[1]);
    }
  });

  it("answerMd only contains substrings drawn from the row fields (no invented facts)", async () => {
    const rows = [
      {
        slug: "member-chat-copilot",
        title: "Member Chat Copilot",
        approver: "Angela Torres",
        detail: "controls: 2 attached (2 met)",
        eventTs: "2026-07-15T14:02:00Z",
      },
    ];
    const result = await port.auditorAnswer(
      auditorInput({ groundingRows: rows, question: "Tell me about Member Chat Copilot" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Every literal field value that appears in the answer must be a value
      // that was actually present on a supplied row.
      expect(result.value.answerMd).toContain("Member Chat Copilot");
      expect(result.value.answerMd).toContain("Angela Torres");
      expect(result.value.answerMd).toContain("2026-07-15T14:02:00Z");
      // No hardcoded healthcare/PHI general-knowledge prose should appear —
      // guard against a couple of plausible-sounding invented phrases.
      expect(result.value.answerMd).not.toMatch(/HIPAA requires/i);
      expect(result.value.answerMd).not.toMatch(/typically|usually|in general/i);
    }
  });

  it("is deterministic for the same input", async () => {
    const rows = [{ slug: "x", title: "X", eventTs: "2026-01-01T00:00:00Z" }];
    const first = await port.auditorAnswer(auditorInput({ groundingRows: rows }));
    const second = await port.auditorAnswer(auditorInput({ groundingRows: rows }));
    expect(first).toEqual(second);
  });

  it("resolves cancelled when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await port.auditorAnswer(auditorInput(), { signal: controller.signal });
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });
});

/* -------------------------------------------------------------------------
 * intakeInterview (M2)
 * ---------------------------------------------------------------------- */

/** intake-spec §1(g) / agents/intake/instructions.md verbatim overlay text. */
const OVERLAY_QUESTIONS: { field: string; question: string; helper: string }[] = [
  {
    field: "touchesPHI",
    question: "Does it access PHI?",
    helper:
      "Determines Privacy/HIPAA control applicability (H-01, H-02) and drives the PHI-category/retention questions above.",
  },
  {
    field: "memberFacing",
    question: "Do members interact with or receive its output directly?",
    helper:
      "Member-facing systems carry higher individual-impact and consumer-protection exposure, and add Legal review (L-02).",
  },
  {
    field: "careCoverageInfluence",
    question: "Does it influence care or coverage decisions?",
    helper:
      "The single strongest driver of tier — care/coverage influence without a human check is Critical (tier rule 1).",
  },
  {
    field: "vendorHosted",
    question: "Is the model vendor-hosted?",
    helper:
      "Vendor hosting triggers Procurement and Legal control requirements (contract addendum, VRA, data-residency attestation).",
  },
  {
    field: "humanInTheLoop",
    question: "Does a qualified human review each output before it takes effect?",
    helper:
      "A human-in-the-loop check downgrades otherwise-Critical care/coverage cases to High (tier rule 2) — it is a mitigating control, not a formality.",
  },
  {
    field: "individualImpact",
    question:
      "Does it affect individuals' opportunities, rights, or services (members, providers, or employees)?",
    helper:
      "Individual-impact combined with member-facing is an independent High-tier trigger, and feeds Medium-tier default even absent other flags.",
  },
];

function emptyOverlay(): Record<string, boolean | null> {
  return {
    touchesPHI: null,
    memberFacing: null,
    careCoverageInfluence: null,
    vendorHosted: null,
    humanInTheLoop: null,
    individualImpact: null,
  };
}

function intakeInput(
  overrides: Partial<IntakeInterviewInput> = {},
): IntakeInterviewInput {
  return {
    conversation: [],
    partialPayload: { overlay: emptyOverlay() },
    ...overrides,
  };
}

describe("createMockAgentPort — intakeInterview", () => {
  const port = createMockAgentPort();

  it("asks the first overlay question (touchesPHI) verbatim, with its helper line, when overlay is entirely null", async () => {
    const result = await port.intakeInterview(intakeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.followUpQuestions).toHaveLength(1);
      const q = result.value.followUpQuestions[0]!;
      expect(q).toContain(OVERLAY_QUESTIONS[0]!.question);
      expect(q).toContain(OVERLAY_QUESTIONS[0]!.helper);
    }
  });

  it("asks each overlay question verbatim in fixed order across successive calls with progressively-filled partialPayload", async () => {
    let overlay = emptyOverlay();
    for (let i = 0; i < OVERLAY_QUESTIONS.length; i++) {
      const result = await port.intakeInterview(
        intakeInput({ partialPayload: { overlay } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const expected = OVERLAY_QUESTIONS[i]!;
      expect(result.value.followUpQuestions).toHaveLength(1);
      expect(result.value.followUpQuestions[0]).toBe(
        `${expected.question} ${expected.helper}`,
      );
      // Simulate the field now being answered, to advance to the next question.
      overlay = { ...overlay, [expected.field]: true };
    }
  });

  it("returns a deterministic closing acknowledgment once all six overlay questions are answered", async () => {
    const overlay = {
      touchesPHI: true,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: true,
      humanInTheLoop: true,
      individualImpact: false,
    };
    const result = await port.intakeInterview(intakeInput({ partialPayload: { overlay } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.followUpQuestions).toHaveLength(1);
      expect(result.value.followUpQuestions[0]).not.toMatch(/PHI|member|vendor/i);
    }
  });

  it('merges an unambiguous "yes" answer from the last user message into the pending overlay field', async () => {
    const result = await port.intakeInterview(
      intakeInput({
        conversation: [{ role: "user", content: "Yes, it does access PHI." }],
        partialPayload: { overlay: emptyOverlay() },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.value.payload.overlay as Record<string, unknown>;
      expect(overlay.touchesPHI).toBe(true);
    }
  });

  it('merges an unambiguous "no" answer from the last user message into the pending overlay field', async () => {
    const result = await port.intakeInterview(
      intakeInput({
        conversation: [{ role: "user", content: "No, it doesn't." }],
        partialPayload: { overlay: emptyOverlay() },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.value.payload.overlay as Record<string, unknown>;
      expect(overlay.touchesPHI).toBe(false);
    }
  });

  it("leaves the field null (never coerced to false) when the last user message is ambiguous", async () => {
    const result = await port.intakeInterview(
      intakeInput({
        conversation: [{ role: "user", content: "I'm not totally sure, maybe?" }],
        partialPayload: { overlay: emptyOverlay() },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.value.payload.overlay as Record<string, unknown>;
      expect(overlay.touchesPHI).toBeNull();
    }
  });

  it("leaves the field null when there is no user message yet", async () => {
    const result = await port.intakeInterview(intakeInput({ conversation: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.value.payload.overlay as Record<string, unknown>;
      expect(overlay.touchesPHI).toBeNull();
    }
  });

  it("does not mutate the input partialPayload", async () => {
    const partialPayload = { overlay: emptyOverlay() };
    const frozenOverlayBefore = JSON.stringify(partialPayload);
    await port.intakeInterview(
      intakeInput({
        conversation: [{ role: "user", content: "Yes" }],
        partialPayload,
      }),
    );
    expect(JSON.stringify(partialPayload)).toBe(frozenOverlayBefore);
  });

  it("is deterministic for the same input", async () => {
    const input = intakeInput({
      conversation: [{ role: "user", content: "Yes, it touches PHI." }],
    });
    const first = await port.intakeInterview(input);
    const second = await port.intakeInterview(input);
    expect(first).toEqual(second);
  });

  it("resolves cancelled when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await port.intakeInterview(intakeInput(), {
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });
});
