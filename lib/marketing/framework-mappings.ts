/**
 * Framework crosswalk for the marketing pages (/frameworks/*): maps every
 * seeded governance control to the NIST AI RMF 1.0 functions and the EU AI
 * Act high-risk requirements it helps evidence.
 *
 * Content rules (marketing hard rules, mirroring the demo's):
 * - Summary-level references only. NIST refs stop at the category level
 *   except where a subcategory is unambiguous (MEASURE 2.7/2.10/2.11); EU
 *   refs cite articles, not clause-by-clause readings.
 * - Every controlId here MUST exist in scripts/seed.ts CONTROL_SEEDS —
 *   enforced by tests/ui/framework-mappings.test.ts so the marketing pages
 *   can never drift from the demo catalog they advertise.
 * - This is positioning content, not compliance advice — every page that
 *   renders it must show FRAMEWORK_DISCLAIMER.
 */

export interface FrameworkRef {
  /** Short citation, e.g. "GOVERN 6" or "Art. 14". */
  ref: string;
  /** Human label for the citation, e.g. "Human oversight". */
  label: string;
}

export interface ControlFrameworkMapping {
  /** Seeded control id (scripts/seed.ts CONTROL_SEEDS). */
  controlId: string;
  /** Control name — duplicated from the seed for static rendering; the
   *  integrity test asserts it matches the catalog. */
  controlName: string;
  nistAiRmf: FrameworkRef[];
  euAiAct: FrameworkRef[];
  /** How the Jeeves workflow actually evidences this control. */
  evidence: string;
}

export const FRAMEWORK_DISCLAIMER =
  "Informational summary for product-evaluation purposes — not legal or compliance advice. Framework applicability depends on your system, role, and jurisdiction.";

export interface FrameworkPageMeta {
  slug: "nist-ai-rmf" | "eu-ai-act";
  title: string;
  shortName: string;
  intro: string;
  /** Which column of ControlFrameworkMapping this page renders. */
  refKey: "nistAiRmf" | "euAiAct";
}

export const FRAMEWORK_PAGES: FrameworkPageMeta[] = [
  {
    slug: "nist-ai-rmf",
    title: "Jeeves and the NIST AI Risk Management Framework",
    shortName: "NIST AI RMF",
    intro:
      "The NIST AI RMF 1.0 organizes trustworthy-AI practice into four functions — GOVERN, MAP, MEASURE, and MANAGE. Jeeves operationalizes them as a workflow: structured intake maps context and risk, tiered reviews and named approvers implement governance, controls and evals measure trustworthiness, and continuous monitoring with an append-only audit trail manages deployed systems. The crosswalk below shows where each control in the demo catalog does that work.",
    refKey: "nistAiRmf",
  },
  {
    slug: "eu-ai-act",
    title: "Jeeves and the EU AI Act (high-risk requirements)",
    shortName: "EU AI Act",
    intro:
      "For high-risk AI systems, the EU AI Act requires a risk management system (Art. 9), data governance (Art. 10), technical documentation (Art. 11), record-keeping (Art. 12), transparency to deployers (Art. 13), human oversight (Art. 14), and accuracy, robustness and cybersecurity (Art. 15), with post-market monitoring and incident reporting (Arts. 72–73). Jeeves gives each of these an owner, a gate, and an audit trail. The crosswalk below maps the demo's control catalog onto those obligations.",
    refKey: "euAiAct",
  },
];

export const CONTROL_FRAMEWORK_MAPPINGS: ControlFrameworkMapping[] = [
  {
    controlId: "L-01",
    controlName: "Vendor contract AI addendum",
    nistAiRmf: [
      { ref: "GOVERN 6", label: "Third-party risks and supply chain" },
      { ref: "MAP 4", label: "Third-party risks and benefits mapped" },
    ],
    euAiAct: [{ ref: "Art. 25", label: "Responsibilities along the AI value chain" }],
    evidence:
      "Gate control on vendor-built initiatives: approval cannot complete without the signed addendum recorded as required evidence.",
  },
  {
    controlId: "L-02",
    controlName: "Marketing-claims review",
    nistAiRmf: [{ ref: "GOVERN 4", label: "Risk communication culture" }],
    euAiAct: [{ ref: "Art. 50", label: "Transparency obligations toward users" }],
    evidence:
      "Quarterly monitor on member-facing initiatives with an approved-copy log as evidence, owned by the Legal domain reviewer.",
  },
  {
    controlId: "P-01",
    controlName: "Vendor risk assessment",
    nistAiRmf: [
      { ref: "GOVERN 6", label: "Third-party risks and supply chain" },
      { ref: "MAP 4", label: "Third-party risks and benefits mapped" },
    ],
    euAiAct: [{ ref: "Art. 25", label: "Responsibilities along the AI value chain" }],
    evidence:
      "Annual gate for vendor systems: the VRA document is required evidence before approval, with a named procurement owner.",
  },
  {
    controlId: "P-02",
    controlName: "SaaS data-residency attestation",
    nistAiRmf: [{ ref: "GOVERN 6", label: "Third-party risks and supply chain" }],
    euAiAct: [{ ref: "Art. 10", label: "Data and data governance" }],
    evidence:
      "Annual monitored attestation for vendor SaaS, tracked per initiative with due dates and overdue surfacing.",
  },
  {
    controlId: "T-01",
    controlName: "Architecture review record",
    nistAiRmf: [
      { ref: "MAP 3", label: "AI capabilities and system context understood" },
      { ref: "GOVERN 1", label: "Policies and processes in place" },
    ],
    euAiAct: [{ ref: "Art. 11", label: "Technical documentation" }],
    evidence:
      "Gate for medium+ tiers: ARB minutes recorded once and on material change, versioned against the initiative.",
  },
  {
    controlId: "T-02",
    controlName: "Disaster-recovery plan",
    nistAiRmf: [{ ref: "MEASURE 2.7", label: "Security and resilience evaluated" }],
    euAiAct: [{ ref: "Art. 15", label: "Accuracy, robustness and cybersecurity" }],
    evidence:
      "Annual monitored control for high+ tiers with the DR test log as evidence.",
  },
  {
    controlId: "R-01",
    controlName: "Bias & fairness testing",
    nistAiRmf: [{ ref: "MEASURE 2.11", label: "Fairness and bias evaluated" }],
    euAiAct: [
      { ref: "Art. 10", label: "Data governance — bias examination" },
      { ref: "Art. 15", label: "Accuracy, robustness and cybersecurity" },
    ],
    evidence:
      "Semi-annual gate on member-facing and care/coverage systems; the Responsible AI reviewer signs against the test report.",
  },
  {
    controlId: "R-02",
    controlName: "Model card published",
    nistAiRmf: [
      { ref: "MAP 3", label: "AI capabilities and system context understood" },
      { ref: "GOVERN 4", label: "Risk communication culture" },
    ],
    euAiAct: [
      { ref: "Art. 11", label: "Technical documentation" },
      { ref: "Art. 13", label: "Transparency and information to deployers" },
    ],
    evidence:
      "Monitored on every version change for medium+ tiers; the model card is the required evidence artifact.",
  },
  {
    controlId: "S-01",
    controlName: "Pen test / threat model",
    nistAiRmf: [{ ref: "MEASURE 2.7", label: "Security and resilience evaluated" }],
    euAiAct: [{ ref: "Art. 15", label: "Accuracy, robustness and cybersecurity" }],
    evidence:
      "Annual gate for high+ tiers: approval requires the current report on file, with a named security owner.",
  },
  {
    controlId: "S-02",
    controlName: "Secrets & access review",
    nistAiRmf: [{ ref: "MEASURE 2.7", label: "Security and resilience evaluated" }],
    euAiAct: [{ ref: "Art. 15", label: "Accuracy, robustness and cybersecurity" }],
    evidence:
      "Quarterly monitored review across every initiative; the access matrix is tracked as recurring evidence.",
  },
  {
    controlId: "H-01",
    controlName: "PHI minimization & BAA",
    nistAiRmf: [{ ref: "MEASURE 2.10", label: "Privacy risk evaluated" }],
    euAiAct: [{ ref: "Art. 10", label: "Data and data governance" }],
    evidence:
      "Gate on any PHI-touching initiative: DPIA plus BAA are required evidence, re-checked on data change — the HIPAA minimum-necessary overlay in the catalog.",
  },
  {
    controlId: "H-02",
    controlName: "De-identification validation",
    nistAiRmf: [{ ref: "MEASURE 2.10", label: "Privacy risk evaluated" }],
    euAiAct: [{ ref: "Art. 10", label: "Data and data governance" }],
    evidence:
      "Annual gate where PHI meets a vendor: the de-identification validation report is required before approval.",
  },
  {
    controlId: "C-01",
    controlName: "Clinician-in-the-loop protocol",
    nistAiRmf: [{ ref: "GOVERN 3", label: "Human-AI roles and oversight defined" }],
    euAiAct: [{ ref: "Art. 14", label: "Human oversight" }],
    evidence:
      "Gate on care/coverage systems: a signed clinician-oversight protocol is required evidence, and agents never approve — a named human decision-maker does.",
  },
  {
    controlId: "C-02",
    controlName: "Adverse-event monitoring",
    nistAiRmf: [{ ref: "MANAGE 4", label: "Post-deployment monitoring and response" }],
    euAiAct: [
      { ref: "Art. 72", label: "Post-market monitoring" },
      { ref: "Art. 73", label: "Serious-incident reporting" },
    ],
    evidence:
      "Continuous monitored control on care/coverage systems; incidents land in the monitoring queue with an append-only audit event.",
  },
  {
    controlId: "D-01",
    controlName: "Data lineage & sourcing approval",
    nistAiRmf: [
      { ref: "MAP 2", label: "System categorization and context" },
      { ref: "GOVERN 1", label: "Policies and processes in place" },
    ],
    euAiAct: [{ ref: "Art. 10", label: "Data and data governance" }],
    evidence:
      "Gate for medium+ tiers: the lineage document is approved once and on data change, with a named data-governance owner.",
  },
  {
    controlId: "D-02",
    controlName: "Retention & disposal schedule",
    nistAiRmf: [
      { ref: "MEASURE 2.10", label: "Privacy risk evaluated" },
      { ref: "GOVERN 1", label: "Policies and processes in place" },
    ],
    euAiAct: [{ ref: "Art. 10", label: "Data and data governance" }],
    evidence:
      "Annual monitored schedule on PHI initiatives, tracked with due dates against the retention intent captured at intake.",
  },
  {
    controlId: "Q-01",
    controlName: "Eval quality floor",
    nistAiRmf: [
      { ref: "MEASURE 2", label: "Trustworthy characteristics evaluated" },
      { ref: "MANAGE 4", label: "Post-deployment monitoring and response" },
    ],
    euAiAct: [
      { ref: "Art. 15", label: "Accuracy, robustness and cybersecurity" },
      { ref: "Art. 72", label: "Post-market monitoring" },
    ],
    evidence:
      "Blocking runtime control: hallucination-rate evals run continuously against tier-set thresholds; a sustained breach opens an incident and can pause the deployment.",
  },
];
