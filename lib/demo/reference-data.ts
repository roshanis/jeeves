// Shared fictional reference facts. No persistence, runtime environment, or I/O.
import type { Domain, OverlayFlags, Tier } from "../domain/types";
import { DEMO_PERSONA_DIRECTORY } from "./personas";

export const BASE_DATE_MS = Date.parse("2026-07-01T00:00:00Z");

export const ACTORS = {
  priyaRaman: DEMO_PERSONA_DIRECTORY["priya-raman"],
  danKowalski: DEMO_PERSONA_DIRECTORY["dan-kowalski"],
  elenaVasquez: DEMO_PERSONA_DIRECTORY["elena-vasquez"],
  marcusWebb: DEMO_PERSONA_DIRECTORY["marcus-webb"],
  sofiaGrant: DEMO_PERSONA_DIRECTORY["sofia-grant"],
  jamesLiu: DEMO_PERSONA_DIRECTORY["james-liu"],
  angelaTorres: DEMO_PERSONA_DIRECTORY["angela-torres"],
  rayChen: DEMO_PERSONA_DIRECTORY["ray-chen"],
  niaOkafor: DEMO_PERSONA_DIRECTORY["nia-okafor"],
} as const;

export interface InitiativeSeed {
  slug: string;
  title: string;
  requester: string;
  flags: OverlayFlags;
  expectedTier: Tier;
}

function flags(
  phi: boolean,
  memberFacing: boolean,
  careCoverageInfluence: boolean,
  vendorHosted: boolean,
  humanInLoop: boolean,
  individualImpact: boolean,
): OverlayFlags {
  return { phi, memberFacing, careCoverageInfluence, vendorHosted, humanInLoop, individualImpact };
}

export const INITIATIVE_SEEDS: readonly InitiativeSeed[] = [
  {
    slug: "prior-auth-summarizer",
    title: "Prior-Auth Clinical Summarizer",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, true, true, true, false, true),
    expectedTier: "critical",
  },
  {
    slug: "marketing-ab-tester",
    title: "Marketing Copy A/B Tester",
    requester: ACTORS.danKowalski.name,
    flags: flags(false, false, false, true, true, false),
    expectedTier: "low",
  },
  {
    slug: "social-sentiment-miner",
    title: "Member Social-Media Sentiment Miner",
    requester: ACTORS.danKowalski.name,
    flags: flags(true, true, false, true, true, false),
    expectedTier: "high",
  },
  {
    slug: "member-chat-copilot",
    title: "Member Services Chat Copilot",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, true, false, false, true, false),
    expectedTier: "high",
  },
  {
    slug: "pa-correspondence-model",
    title: "Prior-Auth Correspondence Drafting Model",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, false, true, false, false, true),
    expectedTier: "critical",
  },
  {
    slug: "claims-ocr-coder",
    title: "Claims Document OCR + Coding Model",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, false, true, false, true, true),
    expectedTier: "high",
  },
  {
    slug: "provider-dedup-agent",
    title: "Provider Directory Dedup Agent",
    requester: ACTORS.niaOkafor.name,
    flags: flags(false, false, false, false, true, true),
    expectedTier: "medium",
  },
  {
    slug: "nurse-triage-summarizer",
    title: "Nurse Triage Line Summarizer",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, false, true, false, false, true),
    expectedTier: "critical",
  },
  {
    slug: "formulary-qa-bot",
    title: "Member Formulary Q&A Bot",
    requester: ACTORS.priyaRaman.name,
    flags: flags(true, true, false, true, false, false),
    expectedTier: "high",
  },
  {
    slug: "fwa-anomaly-detector",
    title: "Fraud, Waste & Abuse Anomaly Detector",
    requester: ACTORS.niaOkafor.name,
    flags: flags(true, false, true, false, true, true),
    expectedTier: "high",
  },
  {
    slug: "hr-resume-screener",
    title: "HR Résumé Screener",
    requester: ACTORS.niaOkafor.name,
    flags: flags(false, false, false, true, true, true),
    expectedTier: "medium",
  },
  {
    slug: "callcenter-qa-scorer",
    title: "Call Center QA Auto-Scorer",
    requester: ACTORS.niaOkafor.name,
    flags: flags(false, false, false, false, true, true),
    expectedTier: "medium",
  },
];

export interface ControlSeed {
  id: string;
  domain: Domain | "runtime";
  name: string;
  applicability: string;
  enforcementMode: "monitor" | "gate" | "block";
  cadence: string;
  requiredEvidence: string;
  policySource: string | null;
  owner: string;
  exceptionProcess: string | null;
  remediationOwner: string;
  observationKind?: string;
  tierDefaultThresholds?: Record<Tier, number>;
  sustainedWindow?: number;
}

export const CONTROL_SEEDS: readonly ControlSeed[] = [
  {
    id: "L-01",
    domain: "legal",
    name: "Vendor contract AI addendum",
    applicability: "vendor=Y",
    enforcementMode: "gate",
    cadence: "once",
    requiredEvidence: "signed addendum",
    policySource: "MP-L v3 §MP-L-2",
    owner: ACTORS.jamesLiu.name,
    exceptionProcess: "Legal domain owner may grant a time-boxed exception with VP sign-off.",
    remediationOwner: ACTORS.jamesLiu.name,
  },
  {
    id: "L-02",
    domain: "legal",
    name: "Marketing-claims review",
    applicability: "member-facing=Y",
    enforcementMode: "monitor",
    cadence: "quarterly",
    requiredEvidence: "approved copy log",
    policySource: "MP-L v3 §MP-L-3",
    owner: ACTORS.jamesLiu.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.jamesLiu.name,
  },
  {
    id: "P-01",
    domain: "procurement",
    name: "Vendor risk assessment",
    applicability: "vendor=Y",
    enforcementMode: "gate",
    cadence: "annual",
    requiredEvidence: "VRA doc",
    policySource: "MP-P v2 §MP-P-2",
    owner: ACTORS.niaOkafor.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.niaOkafor.name,
  },
  {
    id: "P-02",
    domain: "procurement",
    name: "SaaS data-residency attestation",
    applicability: "vendor=Y",
    enforcementMode: "monitor",
    cadence: "annual",
    requiredEvidence: "attestation",
    policySource: "MP-P v2 §MP-P-3",
    owner: ACTORS.niaOkafor.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.niaOkafor.name,
  },
  {
    id: "T-01",
    domain: "tech-architecture",
    name: "Architecture review record",
    applicability: "tier>=medium",
    enforcementMode: "gate",
    cadence: "once + on material change",
    requiredEvidence: "ARB minutes",
    policySource: "MP-T v2 §MP-T-2",
    owner: ACTORS.rayChen.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.rayChen.name,
  },
  {
    id: "T-02",
    domain: "tech-architecture",
    name: "Disaster-recovery plan",
    applicability: "tier>=high",
    enforcementMode: "monitor",
    cadence: "annual",
    requiredEvidence: "DR test log",
    policySource: "MP-T v2 §MP-T-3",
    owner: ACTORS.rayChen.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.rayChen.name,
  },
  {
    id: "R-01",
    domain: "responsible-ai",
    name: "Bias & fairness testing",
    applicability: "member-facing=Y or care-coverage=Y",
    enforcementMode: "gate",
    cadence: "semi-annual",
    requiredEvidence: "test report",
    policySource: "MP-R v4 §MP-R-2",
    owner: ACTORS.sofiaGrant.name,
    exceptionProcess: "Program Office may record a time-boxed waiver against a named accountable owner.",
    remediationOwner: ACTORS.sofiaGrant.name,
  },
  {
    id: "R-02",
    domain: "responsible-ai",
    name: "Model card published",
    applicability: "tier>=medium",
    enforcementMode: "monitor",
    cadence: "on version change",
    requiredEvidence: "model card",
    policySource: "MP-R v4 §MP-R-3",
    owner: ACTORS.sofiaGrant.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.sofiaGrant.name,
  },
  {
    id: "S-01",
    domain: "security",
    name: "Pen test / threat model",
    applicability: "tier>=high",
    enforcementMode: "gate",
    cadence: "annual",
    requiredEvidence: "report",
    policySource: "MP-S v3 §MP-S-2",
    owner: ACTORS.rayChen.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.rayChen.name,
  },
  {
    id: "S-02",
    domain: "security",
    name: "Secrets & access review",
    applicability: "all",
    enforcementMode: "monitor",
    cadence: "quarterly",
    requiredEvidence: "access matrix",
    policySource: "MP-S v3 §MP-S-3",
    owner: ACTORS.rayChen.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.rayChen.name,
  },
  {
    id: "H-01",
    domain: "privacy-hipaa",
    name: "PHI minimization & BAA",
    applicability: "PHI=Y",
    enforcementMode: "gate",
    cadence: "once + on data change",
    requiredEvidence: "DPIA + BAA",
    policySource: "MP-H v3 §MP-H-2",
    owner: ACTORS.marcusWebb.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.marcusWebb.name,
  },
  {
    id: "H-02",
    domain: "privacy-hipaa",
    name: "De-identification validation",
    applicability: "PHI=Y and vendor=Y",
    enforcementMode: "gate",
    cadence: "annual",
    requiredEvidence: "validation report",
    policySource: "MP-H v3 §MP-H-3",
    owner: ACTORS.marcusWebb.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.marcusWebb.name,
  },
  {
    id: "C-01",
    domain: "clinical-safety",
    name: "Clinician-in-the-loop protocol",
    applicability: "care-coverage=Y",
    enforcementMode: "gate",
    cadence: "once",
    requiredEvidence: "signed protocol",
    policySource: "MP-C v3 §MP-C-2",
    owner: ACTORS.elenaVasquez.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.elenaVasquez.name,
  },
  {
    id: "C-02",
    domain: "clinical-safety",
    name: "Adverse-event monitoring",
    applicability: "care-coverage=Y",
    enforcementMode: "monitor",
    cadence: "continuous",
    requiredEvidence: "incident log",
    policySource: "MP-C v3 §MP-C-3",
    owner: ACTORS.elenaVasquez.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.elenaVasquez.name,
  },
  {
    id: "D-01",
    domain: "data-governance",
    name: "Data lineage & sourcing approval",
    applicability: "tier>=medium",
    enforcementMode: "gate",
    cadence: "once + on data change",
    requiredEvidence: "lineage doc",
    policySource: "MP-D v2 §MP-D-2",
    owner: ACTORS.niaOkafor.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.niaOkafor.name,
  },
  {
    id: "D-02",
    domain: "data-governance",
    name: "Retention & disposal schedule",
    applicability: "PHI=Y",
    enforcementMode: "monitor",
    cadence: "annual",
    requiredEvidence: "schedule",
    policySource: "MP-D v2 §MP-D-3",
    owner: ACTORS.niaOkafor.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.niaOkafor.name,
  },
  {
    id: "Q-01",
    domain: "runtime",
    name: "Eval quality floor",
    applicability: "all deployed initiatives with an eval_hallucination series",
    enforcementMode: "block",
    cadence: "continuous",
    requiredEvidence: "monitor run output",
    policySource: null, // intentionally not a policy-corpus citation (INDEX.md)
    owner: ACTORS.rayChen.name,
    exceptionProcess: null,
    remediationOwner: ACTORS.rayChen.name,
    observationKind: "eval_hallucination",
    tierDefaultThresholds: { low: 0.08, medium: 0.08, high: 0.08, critical: 0.05 },
    sustainedWindow: 3,
  },
];
