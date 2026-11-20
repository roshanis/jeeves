import { ADDITIONAL_INTAKE_QUESTIONS } from "./additional-questions";

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  phi: "1. Does it access PHI?",
  memberFacing: "2. Do members interact with or receive its output directly?",
  careCoverageInfluence: "3. Does it influence care or coverage decisions?",
  vendorHosted: "4. Is the model vendor-hosted?",
  humanInLoop: "5. Does a qualified human review each output before it takes effect?",
  individualImpact: "6. Does it affect individuals' opportunities, rights, or services?",
  "data.retentionIntent": "Data retention",
  "data.sourceSystems": "Data sources",
  evidenceAttachments: "Evidence attached at intake",
  "basics.title": "Title",
  "basics.sponsorOrg": "Sponsor organization",
  "basics.requesterName": "Requester name",
  "basics.requesterEmail": "Requester email",
  "basics.businessProblem": "Business problem",
  "useCase.primaryUsers": "Who uses it",
  "useCase.decisionInformed": "Decision it informs",
  "useCase.expectedVolume": "Expected volume",
  "data.dataSources": "Data sources",
  "data.phiCategories": "PHI categories touched",
  "data.phiCategoriesOtherText": "Other PHI category",
  "data.retentionIntentNote": "Retention note",
  "data.trainingVsInference": "Training vs. inference use",
  "modelVendor.buildOrBuy": "Build or buy",
  "modelVendor.vendorName": "Vendor name",
  "modelVendor.hosting": "Hosting",
  "modelVendor.modelType": "Model type",
  "populationImpact.affectedPopulations": "Affected populations",
  "populationImpact.expectedBenefits": "Expected benefits",
  "populationImpact.expectedHarms": "Expected harms / risks",
  "deployment.integrationPoints": "Integration points",
  "deployment.rolloutPlan": "Rollout plan",
  "overlay.touchesPHI": "1. Does it access PHI?",
  "overlay.memberFacing": "2. Do members interact with or receive its output directly?",
  "overlay.careCoverageInfluence": "3. Does it influence care or coverage decisions?",
  "overlay.vendorHosted": "4. Is the model vendor-hosted?",
  "overlay.phi": "1. Does it access PHI?",
  "overlay.humanInLoop": "5. Does a qualified human review each output before it takes effect?",
  "overlay.humanInTheLoop": "5. Does a qualified human review each output before it takes effect?",
  "overlay.individualImpact": "6. Does it affect individuals' opportunities, rights, or services (members, providers, or employees)?",
};

export const ADDITIONAL_FIELD_LABELS = Object.fromEntries(
  Object.entries(ADDITIONAL_INTAKE_QUESTIONS).flatMap(([section, questions]) =>
    questions.map(({ key, question }) => [`${section}.${key}`, question]),
  ),
);

const ATTACHMENT_FIELD_LABEL: Record<string, string> = { controlId: "control", fileName: "file name", uploadedAt: "uploaded at" };

/** Readable label for a stored intake field path; the path itself when none is known. */
export function fieldLabel(key: string): string {
  const attachment = /^evidenceAttachments\.(\d+)\.(\w+)$/.exec(key);
  if (attachment) return `Evidence attachment ${attachment[1]}: ${ATTACHMENT_FIELD_LABEL[attachment[2]] ?? attachment[2]}`;
  return ADDITIONAL_FIELD_LABELS[key] ?? FIELD_LABEL[key] ?? key;
}

/**
 * Label for the path of a validation issue. The server counts the entries of a
 * list from 0 and the intake tab numbers its rows from 1, so a position is
 * shown 1-based: an attachment's field reads as its row does, and an entry of
 * any other list as that list's label plus the position.
 */
export function issueFieldLabel(path: string): string {
  const rowPath = path.replace(/^evidenceAttachments\.(\d+)\./, (_, index) => `evidenceAttachments.${Number(index) + 1}.`);
  const entry = /^(.+)\.(\d+)$/.exec(rowPath);
  return entry ? `${fieldLabel(entry[1])}, item ${Number(entry[2]) + 1}` : fieldLabel(rowPath);
}
