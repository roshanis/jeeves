import { CHAMPION_PREFILL_PAYLOAD } from "../../lib/intake/champion-prefill";

export const EXPANDED_INTAKE = {
  ...CHAMPION_PREFILL_PAYLOAD,
  useCase: {
    ...CHAMPION_PREFILL_PAYLOAD.useCase,
    currentWorkflow: "Nurses assemble fictional coverage packets manually.",
    successMetrics: "Reduce preparation from 30 to 20 minutes with no increase in missed details.",
  },
  data: {
    ...CHAMPION_PREFILL_PAYLOAD.data,
    vendorDataReuse: "Unknown; procurement will confirm retention and model-training terms.",
  },
  populationImpact: {
    ...CHAMPION_PREFILL_PAYLOAD.populationImpact,
    evaluationPlan: "Compare summaries with clinician labels, including language and age groups.",
  },
  deployment: {
    ...CHAMPION_PREFILL_PAYLOAD.deployment,
    operationalOwner: "Clinical Operations service team",
    humanReviewProcess: "The duty nurse reviews every summary and escalates disputed details.",
    monitoringPlan: "Quality analysts review error rates weekly and escalate safety alerts immediately.",
    fallbackPlan: "Pause generation and return to manual packet preparation.",
  },
};

export const ADDITIONAL_ANSWERS = [
  ["How is this work handled today?", EXPANDED_INTAKE.useCase.currentWorkflow],
  ["How will success be measured against today's baseline?", EXPANDED_INTAKE.useCase.successMetrics],
  ["Can the vendor retain inputs or outputs or reuse them for training?", EXPANDED_INTAKE.data.vendorDataReuse],
  ["How will accuracy and performance across affected groups be tested?", EXPANDED_INTAKE.populationImpact.evaluationPlan],
  ["Which role or team owns the system after launch?", EXPANDED_INTAKE.deployment.operationalOwner],
  ["Who reviews outputs, and how can they override or escalate them?", EXPANDED_INTAKE.deployment.humanReviewProcess],
  ["What will be monitored after launch, and who handles alerts?", EXPANDED_INTAKE.deployment.monitoringPlan],
  ["What happens if the system fails or produces unsafe output?", EXPANDED_INTAKE.deployment.fallbackPlan],
] as const;
