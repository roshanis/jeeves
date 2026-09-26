/** Intake domain types derived from the runtime answer contract. */
import type { z } from "zod";
import type { Tier } from "../domain/types";
import type { intakePayloadSchema } from "./schema";

/** Input permits historical drafts to omit the eight additional answers. */
export type IntakePayload = z.input<typeof intakePayloadSchema>;
export type IntakeBasics = IntakePayload["basics"];
export type IntakeUseCase = IntakePayload["useCase"];
export type IntakeData = IntakePayload["data"];
export type IntakeModelVendor = IntakePayload["modelVendor"];
export type IntakePopulationImpact = IntakePayload["populationImpact"];
export type IntakeDeployment = IntakePayload["deployment"];
export type IntakeOverlay = IntakePayload["overlay"];
export type EvidenceAttachment = IntakePayload["evidenceAttachments"][number];
export type ExpectedVolume = NonNullable<IntakeUseCase["expectedVolume"]>;
export type PhiCategory = IntakeData["phiCategories"][number];
export type RetentionIntent = NonNullable<IntakeData["retentionIntent"]>;
export type TrainingVsInference = NonNullable<IntakeData["trainingVsInference"]>;
export type BuildOrBuy = NonNullable<IntakeModelVendor["buildOrBuy"]>;
export type Hosting = NonNullable<IntakeModelVendor["hosting"]>;
export type ModelType = NonNullable<IntakeModelVendor["modelType"]>;

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
