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

/**
 * Complete, editable example for "Use a sample initiative". These fictional
 * plans and targets are proposed answers, not verified results, vendor terms
 * or accepted evidence. Keep the original partial champion above for the
 * seeded storyline and missing-answer regression tests.
 */
export const SAMPLE_INITIATIVE_PAYLOAD: IntakePayload = {
  ...CHAMPION_PREFILL_PAYLOAD,
  useCase: {
    ...CHAMPION_PREFILL_PAYLOAD.useCase,
    currentWorkflow:
      "Prior-auth nurses read clinical notes, visit summaries, lab results and claims history, then manually assemble a coverage-decision packet and route unclear evidence to a clinician.",
    successMetrics:
      "Synthetic baseline: 18 minutes to prepare a packet and a 4.5-day backlog. Proposed targets: 6 minutes per packet and a 2-day backlog, with no increase in omitted clinically relevant facts or incorrect determinations.",
  },
  data: {
    ...CHAMPION_PREFILL_PAYLOAD.data,
    retentionIntent: "<=30 days",
    retentionIntentNote:
      "Synthetic proposal: delete vendor-held inputs and outputs within 30 days; retain the source clinical record under Meridian's existing record schedule. Privacy and Procurement must verify the terms before launch.",
    vendorDataReuse:
      "The proposal prohibits shared-model training or other vendor reuse of inputs and outputs and requests deletion within 30 days. Actual vendor retention, backup deletion and reuse rights remain unconfirmed pending Procurement and Privacy review; these are proposed terms, not an executed agreement.",
  },
  populationImpact: {
    ...CHAMPION_PREFILL_PAYLOAD.populationImpact,
    evaluationPlan:
      "Clinical reviewers will compare 200 fictional packets with source notes, including age, language and complex-condition groups. Proposed acceptance: at least 95% factual agreement, no critical omissions and no group more than 5 percentage points below the overall result. No completed evaluation is claimed.",
  },
  deployment: {
    ...CHAMPION_PREFILL_PAYLOAD.deployment,
    operationalOwner:
      "Clinical Operations owns the service, with the prior-authorization operations lead accountable for support and the clinical safety lead handling safety escalation.",
    humanReviewProcess:
      "The proposed pilot has nurse review of each summary. The wider proposed workflow does not yet guarantee qualified review of every output before it affects a coverage packet, so human-in-the-loop remains No. Nurses can correct a packet or escalate disputed evidence to the clinical safety lead.",
    monitoringPlan:
      "The Clinical Operations quality team will review factual omissions, corrections, packet time and backlog weekly. Critical clinical errors trigger immediate escalation to the clinical safety lead and platform on-call team.",
    fallbackPlan:
      "Pause summarization after a critical clinical error, suspected PHI exposure or vendor outage. Nurses return to manual source-document review; the operational owner requests restart only after remediation and the required human review.",
  },
};
