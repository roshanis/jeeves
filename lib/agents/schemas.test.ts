import { describe, expect, it } from "vitest";
import {
  auditorAnswerOutputSchema,
  intakeInterviewOutputSchema,
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

/* -------------------------------------------------------------------------
 * Auditor agent — agents/auditor/instructions.md "Output"
 * ---------------------------------------------------------------------- */

describe("auditorAnswerOutputSchema", () => {
  const validAnswer = {
    answerMd:
      "Member Chat Copilot was approved by Angela Torres on 2026-07-15 (event ts 2026-07-15T14:02:00Z).",
    citedEvents: ["2026-07-15T14:02:00Z"],
    queryUsed: "approved-by-torres",
  };

  it("accepts a valid fixture", () => {
    expect(auditorAnswerOutputSchema.safeParse(validAnswer).success).toBe(true);
  });

  it("accepts an empty citedEvents array (e.g. on refusal)", () => {
    expect(
      auditorAnswerOutputSchema.safeParse({ ...validAnswer, citedEvents: [] })
        .success,
    ).toBe(true);
  });

  it('accepts an empty queryUsed string ("as supplied in the input")', () => {
    expect(
      auditorAnswerOutputSchema.safeParse({ ...validAnswer, queryUsed: "" })
        .success,
    ).toBe(true);
  });

  it("rejects a fixture missing answerMd", () => {
    const fixture: Record<string, unknown> = { ...validAnswer };
    delete fixture.answerMd;
    expect(auditorAnswerOutputSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects an empty answerMd string (min length 1)", () => {
    expect(
      auditorAnswerOutputSchema.safeParse({ ...validAnswer, answerMd: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-string citedEvents entry", () => {
    expect(
      auditorAnswerOutputSchema.safeParse({
        ...validAnswer,
        citedEvents: [42],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing queryUsed field", () => {
    const fixture: Record<string, unknown> = { ...validAnswer };
    delete fixture.queryUsed;
    expect(auditorAnswerOutputSchema.safeParse(fixture).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Intake agent — agents/intake/instructions.md "Output"
 * ---------------------------------------------------------------------- */

describe("intakeInterviewOutputSchema", () => {
  const emptyPayload = {
    basics: {
      title: "",
      sponsorOrg: "",
      requesterName: "",
      requesterEmail: "",
      businessProblem: "",
    },
    useCase: {
      primaryUsers: "",
      decisionInformed: "",
      expectedVolume: null,
    },
    data: {
      dataSources: [],
      phiCategories: [],
      phiCategoriesOtherText: null,
      retentionIntent: null,
      retentionIntentNote: null,
      trainingVsInference: null,
    },
    modelVendor: {
      buildOrBuy: null,
      vendorName: null,
      hosting: null,
      modelType: null,
    },
    populationImpact: {
      affectedPopulations: [],
      expectedBenefits: null,
      expectedHarms: null,
    },
    deployment: {
      integrationPoints: [],
      rolloutPlan: null,
    },
    overlay: {
      touchesPHI: null,
      memberFacing: null,
      careCoverageInfluence: null,
      vendorHosted: null,
      humanInTheLoop: null,
      individualImpact: null,
    },
    evidenceAttachments: [],
  };

  const validInterview = {
    payload: emptyPayload,
    gaps: [
      { ruleId: "BLK-05", field: "overlay.touchesPHI", level: "BLOCKING" as const },
    ],
    followUpQuestions: ["Does it access PHI?"],
  };

  it("accepts a valid fixture with an entirely-null/empty payload", () => {
    expect(intakeInterviewOutputSchema.safeParse(validInterview).success).toBe(
      true,
    );
  });

  it("accepts a fixture with populated payload fields", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      payload: {
        ...emptyPayload,
        basics: {
          title: "Prior-Auth Clinical Summarizer",
          sponsorOrg: "Clinical Ops",
          requesterName: "Priya Raman",
          requesterEmail: "priya.raman@example.com",
          businessProblem: "Nurses spend too long assembling coverage packets.",
        },
        overlay: {
          ...emptyPayload.overlay,
          touchesPHI: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty gaps array and empty followUpQuestions array", () => {
    expect(
      intakeInterviewOutputSchema.safeParse({
        ...validInterview,
        gaps: [],
        followUpQuestions: [],
      }).success,
    ).toBe(true);
  });

  it("accepts every gaps level enum value (BLOCKING, REQUIRED-FOR-TIER, ADVISORY)", () => {
    for (const level of ["BLOCKING", "REQUIRED-FOR-TIER", "ADVISORY"] as const) {
      const result = intakeInterviewOutputSchema.safeParse({
        ...validInterview,
        gaps: [{ ruleId: "X-01", field: "basics.title", level }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a fixture missing payload", () => {
    const fixture: Record<string, unknown> = { ...validInterview };
    delete fixture.payload;
    expect(intakeInterviewOutputSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a gaps entry with an invalid level enum value", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      gaps: [{ ruleId: "X-01", field: "basics.title", level: "URGENT" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a gaps entry missing ruleId", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      gaps: [{ field: "basics.title", level: "BLOCKING" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string followUpQuestions entry", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      followUpQuestions: [42],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload.overlay field with a non-boolean, non-null value", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      payload: {
        ...emptyPayload,
        overlay: { ...emptyPayload.overlay, touchesPHI: "yes" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload.data.dataSources entry that is not a string", () => {
    const result = intakeInterviewOutputSchema.safeParse({
      ...validInterview,
      payload: {
        ...emptyPayload,
        data: { ...emptyPayload.data, dataSources: [42] },
      },
    });
    expect(result.success).toBe(false);
  });
});
