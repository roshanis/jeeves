/**
 * Zod runtime schema mirroring `IntakePayload` (lib/intake/types.ts,
 * intake-spec §3) — used by `POST /api/initiatives` to validate the request
 * body before it ever reaches `createDraft`/`evaluateCompleteness`. Kept in
 * `lib/services/` (this task's owned directory): `lib/intake/types.ts` is
 * out of scope to modify, and it deliberately has "no runtime logic" per
 * its own file header, so a validator belongs alongside the API layer that
 * needs it rather than there.
 */
import { z } from "zod";
import { ADDITIONAL_ANSWER_MAX_LENGTH } from "@/lib/intake/additional-questions";

const optionalIntakeAnswer = z.string().max(ADDITIONAL_ANSWER_MAX_LENGTH).nullable().default(null);

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

export const intakePayloadSchema = z.object({
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
    currentWorkflow: optionalIntakeAnswer,
    successMetrics: optionalIntakeAnswer,
  }),
  data: z.object({
    dataSources: z.array(z.string().max(200)),
    phiCategories: z.array(phiCategory),
    phiCategoriesOtherText: z.string().max(200).nullable(),
    retentionIntent,
    retentionIntentNote: z.string().max(300).nullable(),
    trainingVsInference,
    vendorDataReuse: optionalIntakeAnswer,
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
    evaluationPlan: optionalIntakeAnswer,
  }),
  deployment: z.object({
    integrationPoints: z.array(z.string().max(200)),
    rolloutPlan: z.string().max(1000).nullable(),
    operationalOwner: optionalIntakeAnswer,
    humanReviewProcess: optionalIntakeAnswer,
    monitoringPlan: optionalIntakeAnswer,
    fallbackPlan: optionalIntakeAnswer,
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
