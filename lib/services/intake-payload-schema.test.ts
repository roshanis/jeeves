import { describe, expect, it } from "vitest";
import { intakePayloadSchema } from "./intake-payload-schema";
import { intakePayloadSchema as agentPayloadSchema } from "@/lib/agents/schemas";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { evaluateCompleteness } from "@/lib/intake/completeness";
import { EXPANDED_INTAKE } from "@/tests/fixtures/expanded-intake";

describe.each([["API", intakePayloadSchema], ["agent", agentPayloadSchema]] as const)("%s additional intake answers", (_name, schema) => {
  it("retains every additional answer instead of stripping it", () => {
    expect(schema.parse(EXPANDED_INTAKE)).toEqual(EXPANDED_INTAKE);
  });

  it("accepts legacy omission as unanswered without changing completeness", () => {
    const parsed = schema.parse(CHAMPION_PREFILL_PAYLOAD);
    expect(parsed).toMatchObject({
      useCase: { currentWorkflow: null, successMetrics: null },
      data: { vendorDataReuse: null },
      populationImpact: { evaluationPlan: null },
      deployment: { operationalOwner: null, humanReviewProcess: null, monitoringPlan: null, fallbackPlan: null },
    });
    expect(evaluateCompleteness(parsed)).toEqual(evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD));
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
});
