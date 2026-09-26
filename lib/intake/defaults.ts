import type { IntakePayload } from "./types";

/** Shared unanswered draft. Editors update immutably; unknown flags remain null. */
export const EMPTY_INTAKE_PAYLOAD: IntakePayload = {
  basics: {
    title: "",
    sponsorOrg: "",
    requesterName: "",
    requesterEmail: "",
    businessProblem: "",
  },
  useCase: { primaryUsers: "", decisionInformed: "", expectedVolume: null, currentWorkflow: null, successMetrics: null },
  data: {
    dataSources: [],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: null,
    vendorDataReuse: null,
  },
  modelVendor: { buildOrBuy: null, vendorName: null, hosting: null, modelType: null },
  populationImpact: { affectedPopulations: [], expectedBenefits: null, expectedHarms: null, evaluationPlan: null },
  deployment: { integrationPoints: [], rolloutPlan: null, operationalOwner: null, humanReviewProcess: null, monitoringPlan: null, fallbackPlan: null },
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
