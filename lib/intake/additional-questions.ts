import type { IntakePayload } from "./types";

export const ADDITIONAL_ANSWER_MAX_LENGTH = 1000;

/** Optional context for reviewers; never used to infer overlay flags or approval. */
export const ADDITIONAL_INTAKE_QUESTIONS = {
  useCase: [
    { key: "currentWorkflow", question: "How is this work handled today?", hint: "Describe the current steps, tools, and manual handoffs." },
    { key: "successMetrics", question: "How will success be measured against today's baseline?", hint: "Include a current measure, target, and any quality or safety limits." },
  ],
  data: [
    { key: "vendorDataReuse", question: "Can the vendor retain inputs or outputs or reuse them for training?", hint: "Describe the vendor's retention and use for its own or shared models. If unknown, say what needs confirmation." },
  ],
  populationImpact: [
    { key: "evaluationPlan", question: "How will accuracy and performance across affected groups be tested?", hint: "Describe the test examples, acceptance criteria, and groups to compare." },
  ],
  deployment: [
    { key: "operationalOwner", question: "Which role or team owns the system after launch?", hint: "Name the accountable operational role or team, rather than personal contact details." },
    { key: "humanReviewProcess", question: "Who reviews outputs, and how can they override or escalate them?", hint: "Explain when review happens and how corrections or disagreements are handled." },
    { key: "monitoringPlan", question: "What will be monitored after launch, and who handles alerts?", hint: "Include measures, review frequency, and escalation responsibilities." },
    { key: "fallbackPlan", question: "What happens if the system fails or produces unsafe output?", hint: "Describe pause or rollback triggers and the fallback workflow." },
  ],
} as const;

/** Historical drafts omit these fields. Missing answers stay unknown, never "No". */
export function normalizeAdditionalAnswers(payload: IntakePayload): IntakePayload {
  return {
    ...payload,
    useCase: { currentWorkflow: null, successMetrics: null, ...payload.useCase },
    data: { vendorDataReuse: null, ...payload.data },
    populationImpact: { evaluationPlan: null, ...payload.populationImpact },
    deployment: { operationalOwner: null, humanReviewProcess: null, monitoringPlan: null, fallbackPlan: null, ...payload.deployment },
  };
}
