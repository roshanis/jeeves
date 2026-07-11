import { describe, expect, it } from "vitest";
import {
  buildMockReviewerDraft,
  createMockAgentPort,
  generateMockIncidentSummary,
  generateMockTriageRationale,
} from "@/lib/agents/mock-adapter";
import type {
  CompletenessCheckInput,
  DraftReviewInput,
  GovernanceDomain,
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
