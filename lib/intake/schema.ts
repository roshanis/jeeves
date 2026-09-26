/** Domain-owned draft answer contract shared by persistence and model output.
 * Empty strings, nulls and empty arrays represent unanswered questions.
 * Completeness is evaluated separately. Persistence accepts omitted legacy
 * answers; strict model output must supply every answer, using null if unknown.
 */
import { z } from "zod";
import { ADDITIONAL_ANSWER_MAX_LENGTH } from "@/lib/intake/additional-questions";

const nullableIntakeAnswer = z.string().max(ADDITIONAL_ANSWER_MAX_LENGTH).nullable();

const expectedVolume = z
  .enum(["<100/mo", "100-1k/mo", "1k-10k/mo", "10k-100k/mo", ">100k/mo"])
  .nullable();

const phiCategory = z.enum([
  "Demographics",
  "Diagnosis/ICD codes",
  "Medications",
  "Clinical notes/free text",
  "Claims/billing",
  "Lab results",
  "Images",
  "Other",
]);

const retentionIntent = z
  .enum(["Session-only (no persistence)", "<=30 days", "<=1 year", ">1 year", "Indefinite/per-record-schedule"])
  .nullable();

const trainingVsInference = z.enum(["Inference-only", "Fine-tuning/training", "Both"]).nullable();
const buildOrBuy = z.enum(["Build (internal)", "Buy (vendor)", "Hybrid"]).nullable();
const hosting = z.enum(["Vendor-hosted", "Self-hosted (Meridian infra)"]).nullable();
const modelType = z
  .enum(["LLM (generative)", "Classical ML / classifier", "OCR/extraction", "Rules engine", "Other"])
  .nullable();

function buildIntakePayloadSchema<
  Answer extends typeof nullableIntakeAnswer | z.ZodDefault<typeof nullableIntakeAnswer>,
>(additionalAnswer: Answer) {
  return z.object({
    basics: z.object({
      title: z.string().max(120),
      sponsorOrg: z.string().max(120),
      requesterName: z.string().max(120),
      requesterEmail: z.string().max(200),
      businessProblem: z.string().max(2000),
    }),
    useCase: z.object({
      primaryUsers: z.string().max(200),
      decisionInformed: z.string().max(300),
      expectedVolume,
      currentWorkflow: additionalAnswer,
      successMetrics: additionalAnswer,
    }),
    data: z.object({
      dataSources: z.array(z.string().max(200)),
      phiCategories: z.array(phiCategory),
      phiCategoriesOtherText: z.string().max(200).nullable(),
      retentionIntent,
      retentionIntentNote: z.string().max(300).nullable(),
      trainingVsInference,
      vendorDataReuse: additionalAnswer,
    }),
    modelVendor: z.object({
      buildOrBuy,
      vendorName: z.string().max(120).nullable(),
      hosting,
      modelType,
    }),
    populationImpact: z.object({
      affectedPopulations: z.array(z.string().max(200)),
      expectedBenefits: z.string().max(1000).nullable(),
      expectedHarms: z.string().max(1000).nullable(),
      evaluationPlan: additionalAnswer,
    }),
    deployment: z.object({
      integrationPoints: z.array(z.string().max(200)),
      rolloutPlan: z.string().max(1000).nullable(),
      operationalOwner: additionalAnswer,
      humanReviewProcess: additionalAnswer,
      monitoringPlan: additionalAnswer,
      fallbackPlan: additionalAnswer,
    }),
    overlay: z.object({
      touchesPHI: z.boolean().nullable(),
      memberFacing: z.boolean().nullable(),
      careCoverageInfluence: z.boolean().nullable(),
      vendorHosted: z.boolean().nullable(),
      humanInTheLoop: z.boolean().nullable(),
      individualImpact: z.boolean().nullable(),
    }),
    evidenceAttachments: z.array(
      z.object({
        controlId: z.string().max(50),
        fileName: z.string().max(300),
        uploadedAt: z.string().max(50),
      }),
    ),
  });
}

/** Saved drafts may predate the additional questions. Normalize omissions to null. */
export const intakePayloadSchema = buildIntakePayloadSchema(nullableIntakeAnswer.default(null));

/** OpenAI strict structured output requires every property, without defaults. */
export const intakeModelPayloadSchema = buildIntakePayloadSchema(nullableIntakeAnswer);
