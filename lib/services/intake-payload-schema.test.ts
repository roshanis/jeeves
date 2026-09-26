import { describe, expect, it } from "vitest";
import { intakePayloadSchema } from "./intake-payload-schema";
import { intakeInterviewOutputSchema } from "@/lib/agents/schemas";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { evaluateCompleteness } from "@/lib/intake/completeness";
import { EXPANDED_INTAKE } from "@/tests/fixtures/expanded-intake";
import { EMPTY_INTAKE_PAYLOAD } from "@/lib/intake/defaults";

const agentPayloadSchema = intakeInterviewOutputSchema.shape.payload;

describe.each([["API", intakePayloadSchema], ["agent", agentPayloadSchema]] as const)("%s additional intake answers", (_name, schema) => {
  it("retains every additional answer instead of stripping it", () => {
    expect(schema.parse(EXPANDED_INTAKE)).toEqual(EXPANDED_INTAKE);
  });

  it("accepts unanswered interview drafts while completeness still blocks submission", () => {
    const draft = schema.parse(EMPTY_INTAKE_PAYLOAD);
    expect(intakePayloadSchema.parse(draft)).toEqual(EMPTY_INTAKE_PAYLOAD);
    expect(evaluateCompleteness(draft).canSubmit).toBe(false);
    expect(Object.values(draft.overlay)).toEqual([null, null, null, null, null, null]);
  });

  it("accepts 1000 characters and rejects oversized or non-text answers", () => {
    for (const [section, key] of [
      ["useCase", "currentWorkflow"], ["useCase", "successMetrics"],
      ["data", "vendorDataReuse"], ["populationImpact", "evaluationPlan"],
      ["deployment", "operationalOwner"], ["deployment", "humanReviewProcess"],
      ["deployment", "monitoringPlan"], ["deployment", "fallbackPlan"],
    ] as const) {
      const withAnswer = (answer: unknown) => ({ ...EXPANDED_INTAKE, [section]: { ...EXPANDED_INTAKE[section], [key]: answer } });
      expect(schema.safeParse(withAnswer("a".repeat(1000))).success).toBe(true);
      expect(schema.safeParse(withAnswer("a".repeat(1001))).success).toBe(false);
      expect(schema.safeParse(withAnswer(false)).success).toBe(false);
    }
  });

  it("enforces persistence text limits before accepting interview answers", () => {
    for (const [section, field, limit] of [
      ["basics", "title", 120], ["basics", "sponsorOrg", 120],
      ["basics", "requesterName", 120], ["basics", "requesterEmail", 200],
      ["basics", "businessProblem", 2000], ["useCase", "primaryUsers", 200],
      ["useCase", "decisionInformed", 300], ["data", "phiCategoriesOtherText", 200],
      ["data", "retentionIntentNote", 300], ["modelVendor", "vendorName", 120],
      ["populationImpact", "expectedBenefits", 1000], ["populationImpact", "expectedHarms", 1000],
      ["deployment", "rolloutPlan", 1000],
    ] as const) {
      const atLimit = { ...EXPANDED_INTAKE, [section]: { ...EXPANDED_INTAKE[section], [field]: "x".repeat(limit) } };
      const beyondLimit = { ...EXPANDED_INTAKE, [section]: { ...EXPANDED_INTAKE[section], [field]: "x".repeat(limit + 1) } };
      expect(schema.safeParse(atLimit).success, `${section}.${field} at limit`).toBe(true);
      expect(schema.safeParse(beyondLimit).success, `${section}.${field} beyond limit`).toBe(false);
      expect(intakePayloadSchema.parse(agentPayloadSchema.parse(atLimit))).toEqual(agentPayloadSchema.parse(atLimit));
    }
  });
});

it("accepts legacy omission for persistence and requires explicit unanswered fields from the model", () => {
  const parsed = intakePayloadSchema.parse(CHAMPION_PREFILL_PAYLOAD);
  expect(parsed).toMatchObject({
    useCase: { currentWorkflow: null, successMetrics: null },
    data: { vendorDataReuse: null },
    populationImpact: { evaluationPlan: null },
    deployment: { operationalOwner: null, humanReviewProcess: null, monitoringPlan: null, fallbackPlan: null },
  });
  expect(evaluateCompleteness(parsed)).toEqual(evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD));
  expect(agentPayloadSchema.safeParse(CHAMPION_PREFILL_PAYLOAD).success).toBe(false);
  expect(agentPayloadSchema.parse(parsed)).toEqual(parsed);
  expect(intakePayloadSchema.parse(agentPayloadSchema.parse(parsed))).toEqual(parsed);
});
