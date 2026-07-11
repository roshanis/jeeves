import { describe, expect, it } from "vitest";
import {
  mapReviewerDraftToPortOutput,
  opsMonitorIncidentOutputSchema,
  reviewerDraftOutputSchema,
  triageRationaleOutputSchema,
  type ReviewerDraftOutput,
} from "@/lib/agents/schemas";

/** A minimal, valid ReviewerDraftOutput fixture (agents/reviewer/schema.md). */
function validReviewerDraft(
  overrides: Partial<ReviewerDraftOutput> = {},
): ReviewerDraftOutput {
  return {
    assessmentMd: "- H-01 PHI minimization: DPIA on file per MP-H v3 §MP-H-2.",
    citations: ["MP-H v3 §MP-H-2"],
    evidenceRequests: [],
    recommendation: "ready-for-signature",
    suggestedConditions: [],
    confidenceNotes: "No open concerns.",
    ...overrides,
  };
}

describe("reviewerDraftOutputSchema", () => {
  it("accepts a valid fixture", () => {
    const result = reviewerDraftOutputSchema.safeParse(validReviewerDraft());
    expect(result.success).toBe(true);
  });

  it("accepts a fixture with populated evidenceRequests and suggestedConditions", () => {
    const result = reviewerDraftOutputSchema.safeParse(
      validReviewerDraft({
        recommendation: "return-with-gaps",
        evidenceRequests: [
          { controlId: "H-01", description: "Missing retention answer." },
        ],
        suggestedConditions: [
          { text: "Raise sampling rate to 20%.", controlId: "C-01" },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a fixture missing assessmentMd", () => {
    const fixture: Record<string, unknown> = validReviewerDraft();
    delete fixture.assessmentMd;
    const result = reviewerDraftOutputSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects an empty assessmentMd string", () => {
    const result = reviewerDraftOutputSchema.safeParse(
      validReviewerDraft({ assessmentMd: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects assessmentMd longer than the soft length guard", () => {
    const result = reviewerDraftOutputSchema.safeParse(
      validReviewerDraft({ assessmentMd: "a".repeat(6001) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid recommendation enum value", () => {
    const result = reviewerDraftOutputSchema.safeParse(
      validReviewerDraft({
        // @ts-expect-error intentionally invalid enum value for the test
        recommendation: "approved",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-string citations entry", () => {
    const result = reviewerDraftOutputSchema.safeParse({
      ...validReviewerDraft(),
      citations: [42],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an evidenceRequests entry missing controlId", () => {
    const result = reviewerDraftOutputSchema.safeParse(
      validReviewerDraft({
        // @ts-expect-error intentionally malformed for the test
        evidenceRequests: [{ description: "missing controlId" }],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("triageRationaleOutputSchema", () => {
  const validTriage = {
    rationaleMd: "This initiative is Critical because ...",
    flagExplanations: [
      { flag: "careCoverageInfluence", answer: "Yes", why: "Drives Critical tier." },
    ],
  };

  it("accepts a valid fixture", () => {
    expect(triageRationaleOutputSchema.safeParse(validTriage).success).toBe(
      true,
    );
  });

  it("accepts an empty flagExplanations array", () => {
    expect(
      triageRationaleOutputSchema.safeParse({
        ...validTriage,
        flagExplanations: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a fixture missing rationaleMd", () => {
    const fixture: Record<string, unknown> = { ...validTriage };
    delete fixture.rationaleMd;
    expect(triageRationaleOutputSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a flagExplanations entry missing `why`", () => {
    const result = triageRationaleOutputSchema.safeParse({
      ...validTriage,
      flagExplanations: [{ flag: "phi", answer: "Yes" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for flagExplanations (not an array)", () => {
    const result = triageRationaleOutputSchema.safeParse({
      ...validTriage,
      flagExplanations: "not-an-array",
    });
    expect(result.success).toBe(false);
  });
});

describe("opsMonitorIncidentOutputSchema", () => {
  const validIncident = {
    incidentSummaryMd: "Q-01 breached threshold 0.05 sustained 3 points.",
    suggestedScope: ["responsible-ai", "clinical-safety"],
    severityNote: "Critical-tier, coverage-influencing initiative.",
  };

  it("accepts a valid fixture", () => {
    expect(
      opsMonitorIncidentOutputSchema.safeParse(validIncident).success,
    ).toBe(true);
  });

  it("accepts an empty suggestedScope array", () => {
    expect(
      opsMonitorIncidentOutputSchema.safeParse({
        ...validIncident,
        suggestedScope: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a suggestedScope value outside the 8-value GovernanceDomain set", () => {
    const result = opsMonitorIncidentOutputSchema.safeParse({
      ...validIncident,
      suggestedScope: ["not-a-real-domain"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fixture missing severityNote", () => {
    const fixture: Record<string, unknown> = { ...validIncident };
    delete fixture.severityNote;
    expect(opsMonitorIncidentOutputSchema.safeParse(fixture).success).toBe(
      false,
    );
  });
});

describe("mapReviewerDraftToPortOutput", () => {
  it('maps "ready-for-signature" -> "recommend-sign-off"', () => {
    const rich = validReviewerDraft({ recommendation: "ready-for-signature" });
    const port = mapReviewerDraftToPortOutput("privacy-hipaa", rich);
    expect(port.recommendation).toBe("recommend-sign-off");
    expect(port.domain).toBe("privacy-hipaa");
  });

  it('maps "return-with-gaps" + empty suggestedConditions -> "recommend-return"', () => {
    const rich = validReviewerDraft({
      recommendation: "return-with-gaps",
      suggestedConditions: [],
      evidenceRequests: [{ controlId: "H-01", description: "Missing DPIA." }],
    });
    const port = mapReviewerDraftToPortOutput("privacy-hipaa", rich);
    expect(port.recommendation).toBe("recommend-return");
    expect(port.missingEvidence).toEqual(["Missing DPIA."]);
  });

  it('maps "return-with-gaps" + non-empty suggestedConditions -> "recommend-conditional"', () => {
    const rich = validReviewerDraft({
      recommendation: "return-with-gaps",
      suggestedConditions: [
        { text: "Raise sampling rate to 20%.", controlId: "C-01" },
      ],
    });
    const port = mapReviewerDraftToPortOutput("clinical-safety", rich);
    expect(port.recommendation).toBe("recommend-conditional");
    expect(port.suggestedConditions).toEqual(["Raise sampling rate to 20%."]);
  });

  it("appends an Evidence requests section to draftMarkdown when evidenceRequests is non-empty", () => {
    const rich = validReviewerDraft({
      recommendation: "return-with-gaps",
      evidenceRequests: [
        { controlId: "H-01", description: "Missing retention answer." },
      ],
    });
    const port = mapReviewerDraftToPortOutput("privacy-hipaa", rich);
    expect(port.draftMarkdown).toContain("## Evidence requests");
    expect(port.draftMarkdown).toContain("Missing retention answer.");
  });

  it("does not append an Evidence requests section when evidenceRequests is empty", () => {
    const rich = validReviewerDraft({ evidenceRequests: [] });
    const port = mapReviewerDraftToPortOutput("legal", rich);
    expect(port.draftMarkdown).not.toContain("## Evidence requests");
  });
});
