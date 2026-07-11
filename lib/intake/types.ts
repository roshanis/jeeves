/**
 * `IntakeVersion` payload types (intake-spec §3).
 *
 * Pure types only — no runtime logic here, matching the convention in
 * `lib/domain/types.ts`. Field keys and literal unions are copied verbatim
 * from intake-spec §3's JSON payload shape.
 */

import type { Tier } from "../domain/types";

/** intake-spec §1(b) `expectedVolume` enum. */
export type ExpectedVolume =
  | "<100/mo"
  | "100-1k/mo"
  | "1k-10k/mo"
  | "10k-100k/mo"
  | ">100k/mo";

/** intake-spec §1(c) `phiCategories` checklist options. */
export type PhiCategory =
  | "Demographics"
  | "Diagnosis/ICD codes"
  | "Medications"
  | "Clinical notes/free text"
  | "Claims/billing"
  | "Lab results"
  | "Images"
  | "Other";

/** intake-spec §1(c) `retentionIntent` enum. */
export type RetentionIntent =
  | "Session-only (no persistence)"
  | "<=30 days"
  | "<=1 year"
  | ">1 year"
  | "Indefinite/per-record-schedule";

/** intake-spec §1(c) `trainingVsInference` enum. */
export type TrainingVsInference = "Inference-only" | "Fine-tuning/training" | "Both";

/** intake-spec §1(d) `buildOrBuy` enum. */
export type BuildOrBuy = "Build (internal)" | "Buy (vendor)" | "Hybrid";

/** intake-spec §1(d) `hosting` enum. */
export type Hosting = "Vendor-hosted" | "Self-hosted (Meridian infra)";

/** intake-spec §1(d) `modelType` enum. */
export type ModelType =
  | "LLM (generative)"
  | "Classical ML / classifier"
  | "OCR/extraction"
  | "Rules engine"
  | "Other";

/** intake-spec §1(a) "Basics" section. */
export interface IntakeBasics {
  title: string;
  sponsorOrg: string;
  requesterName: string;
  requesterEmail: string;
  businessProblem: string;
}

/** intake-spec §1(b) "Use case & users" section. */
export interface IntakeUseCase {
  primaryUsers: string;
  decisionInformed: string;
  expectedVolume: ExpectedVolume | null;
}

/** intake-spec §1(c) "Data" section. */
export interface IntakeData {
  dataSources: string[];
  phiCategories: PhiCategory[];
  phiCategoriesOtherText: string | null;
  retentionIntent: RetentionIntent | null;
  retentionIntentNote: string | null;
  trainingVsInference: TrainingVsInference | null;
}

/** intake-spec §1(d) "Model & vendor" section. */
export interface IntakeModelVendor {
  buildOrBuy: BuildOrBuy | null;
  vendorName: string | null;
  hosting: Hosting | null;
  modelType: ModelType | null;
}

/** intake-spec §1(e) "Population & impact" section. */
export interface IntakePopulationImpact {
  affectedPopulations: string[];
  expectedBenefits: string | null;
  expectedHarms: string | null;
}

/** intake-spec §1(f) "Deployment" section. */
export interface IntakeDeployment {
  integrationPoints: string[];
  rolloutPlan: string | null;
}

/**
 * intake-spec §1(g) "Overlay questions" — the 6 booleans consumed by
 * `lib/triage/rules.ts` (`deriveTier`, via `OverlayFlags`). Field keys here
 * are the `IntakeVersion.payload.overlay.*` names from §3, which differ
 * from `OverlayFlags`'s shorter keys (e.g. `touchesPHI` vs `phi`,
 * `humanInTheLoop` vs `humanInLoop`) — callers map between the two shapes.
 */
export interface IntakeOverlay {
  touchesPHI: boolean | null;
  memberFacing: boolean | null;
  careCoverageInfluence: boolean | null;
  vendorHosted: boolean | null;
  humanInTheLoop: boolean | null;
  individualImpact: boolean | null;
}

/** intake-spec §1(h) evidence attachment entry. */
export interface EvidenceAttachment {
  controlId: string;
  fileName: string;
  uploadedAt: string; // ISO8601
}

/** intake-spec §3 `payload` shape. */
export interface IntakePayload {
  basics: IntakeBasics;
  useCase: IntakeUseCase;
  data: IntakeData;
  modelVendor: IntakeModelVendor;
  populationImpact: IntakePopulationImpact;
  deployment: IntakeDeployment;
  overlay: IntakeOverlay;
  evidenceAttachments: EvidenceAttachment[];
}

/** intake-spec §3 `completeness` computed/cached projection. */
export interface IntakeCompleteness {
  blocking: {
    passed: boolean;
    failedRuleIds: string[];
  };
  requiredForTier: {
    tier: Tier | null;
    failedRuleIds: string[];
  };
  advisory: {
    failedRuleIds: string[];
    score: number;
  };
}

/** intake-spec §3 full `IntakeVersion` record shape. */
export interface IntakeVersion {
  id: string;
  initiativeId: string;
  version: number;
  status: "draft" | "submitted";
  submittedAt: string | null;
  submittedBy: string | null;
  supersedesVersionId: string | null;
  payload: IntakePayload;
  completeness: IntakeCompleteness;
}
