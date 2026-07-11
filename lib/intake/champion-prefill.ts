/**
 * Champion prefill — "Prior-Auth Clinical Summarizer" (intake-spec §4,
 * seed-spec initiative #1).
 *
 * Overlay flags: PHI=Y / member-facing=Y / care-coverage=Y / vendor-hosted=Y
 * / human-in-the-loop=N / individual-impact=Y.
 *
 * Deliberately omits `data.retentionIntent` (and its paired
 * `retentionIntentNote`) so the completeness check visibly flags it live
 * during the demo (intake-spec §4, §5).
 */

import type { IntakePayload } from "./types";

export const CHAMPION_PREFILL_PAYLOAD: IntakePayload = {
  basics: {
    title: "Prior-Auth Clinical Summarizer",
    sponsorOrg: "Clinical Ops",
    requesterName: "Priya Raman",
    requesterEmail: "priya.raman@meridianhealth-demo.example",
    businessProblem:
      "Prior-authorization nurses spend 15-20 minutes per case manually reading clinical notes, prior visit summaries, and lab results scattered across Epic to assemble a coverage-decision packet. Case volume has grown 22% year over year and review backlog now averages 4.5 days, delaying care decisions for members.",
  },
  useCase: {
    primaryUsers: "Prior-authorization nurses (Clinical Ops)",
    decisionInformed:
      "Coverage approval/denial recommendation presented to the prior-auth nurse before she issues the determination",
    expectedVolume: "10k-100k/mo",
  },
  data: {
    dataSources: [
      "Clinical notes (Epic)",
      "Prior visit summaries (Epic)",
      "Lab results (Epic)",
      "Claims history (Facets)",
    ],
    phiCategories: [
      "Diagnosis/ICD codes",
      "Medications",
      "Clinical notes/free text",
      "Lab results",
    ],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: "Inference-only",
  },
  modelVendor: {
    buildOrBuy: "Buy (vendor)",
    vendorName: "Halcyon Clinical AI, Inc.",
    hosting: "Vendor-hosted",
    modelType: "LLM (generative)",
  },
  populationImpact: {
    affectedPopulations: ["Members", "Prior-auth nurses (Clinical Ops)"],
    expectedBenefits:
      "Reduces nurse review time per case from ~18 minutes to an estimated ~6 minutes by pre-summarizing clinical evidence against the applicable coverage policy, shrinking the prior-auth backlog and speeding time-to-decision for members awaiting care.",
    expectedHarms:
      "Summarization errors or omissions could cause a nurse to miss clinically relevant evidence, leading to an incorrect coverage determination; over-reliance on the summary could erode the nurse's independent clinical judgment over time.",
  },
  deployment: {
    integrationPoints: [
      "Prior-auth workflow queue (internal case management system)",
      "Nurse review workbench UI",
    ],
    rolloutPlan:
      "Pilot with one prior-auth team (8 nurses) for 4 weeks with 100% human review of summarizer output before any workflow change, then phased rollout to remaining Clinical Ops teams pending pilot results and Clinical Safety sign-off.",
  },
  overlay: {
    touchesPHI: true,
    memberFacing: true,
    careCoverageInfluence: true,
    vendorHosted: true,
    humanInTheLoop: false,
    individualImpact: true,
  },
  evidenceAttachments: [],
};
