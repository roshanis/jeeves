/**
 * Governance agent registry — the canonical, typed catalog of every AI agent
 * behind Jeeves (the "suite of agents").
 *
 * This is the single source of truth the UI surfaces (app/agents/page.tsx) and
 * a filesystem mirror of what `lib/agents/` adapters actually invoke: the 8
 * per-domain review agents (one governance domain each, each bound to its
 * policy corpus + control family + accountable reviewer persona), plus the
 * lifecycle and oversight agents. It is descriptive metadata, not an execution
 * path — the adapters (openai-adapter.ts / mock-adapter.ts) load the
 * `instructionsPath` content and call `generateText` per AGENTS.md rule 4.
 *
 * Every agent here DRAFTS, RECOMMENDS, or EXPLAINS — none decide (AGENTS.md
 * rule 1). The reviewer suite's per-domain instructions live under
 * `agents/reviewer/tracks/<domain>.md` layered on `agents/reviewer/
 * instructions.md`; the accountable persona per domain is derived from the
 * authoritative `REVIEWER_DOMAIN` map so this registry can never drift from
 * the assignment authz (M2.5 inc.3).
 */
import type { GovernanceDomain } from "./ports";
import { ACTOR_DIRECTORY, reviewerDomainFor, type PersonaKey } from "../services/actors";

export type AgentKind = "reviewer" | "triage" | "intake" | "completeness" | "auditor" | "monitor";

export interface GovernanceAgent {
  /** Stable id, e.g. "reviewer-privacy-hipaa" or "triage". */
  readonly id: string;
  readonly name: string;
  readonly kind: AgentKind;
  /** The AgentPort capability this agent implements. */
  readonly capability: string;
  /** The governance domain this agent reviews, or null for cross-cutting agents. */
  readonly domain: GovernanceDomain | null;
  /** Accountable human reviewer persona (id) who signs this domain, or null. */
  readonly accountablePersona: string | null;
  readonly accountablePersonaName: string | null;
  /** Policy corpus this agent is grounded in, e.g. "MP-H v3". */
  readonly policyId: string | null;
  /** Control family this agent's evidence requests reference, e.g. "H". */
  readonly controlPrefix: string | null;
  /** Path (repo-relative) to the agent's system-prompt instructions. */
  readonly instructionsPath: string;
  readonly summary: string;
}

/** Uniform guardrail — every agent drafts/recommends/explains, never decides. */
export const AGENT_GUARDRAIL =
  "Drafts, recommends, or explains — never approves, signs, or decides. A named, accountable human does that.";

// Per-domain policy corpus + control family (docs/policies/*, seed control
// catalog). Policy versions match the mock adapter's citation fixtures.
const DOMAIN_META: Record<
  GovernanceDomain,
  { name: string; policyId: string; controlPrefix: string; summary: string }
> = {
  legal: {
    name: "Legal Review Agent",
    policyId: "MP-L v3",
    controlPrefix: "L",
    summary:
      "Drafts the legal assessment — vendor contract AI addenda, liability & IP, marketing-claims review — grounded in MP-L.",
  },
  procurement: {
    name: "Procurement Review Agent",
    policyId: "MP-P v2",
    controlPrefix: "P",
    summary:
      "Drafts the procurement assessment — vendor due diligence, sourcing & spend controls — grounded in MP-P.",
  },
  "tech-architecture": {
    name: "Tech Architecture Review Agent",
    policyId: "MP-T v2",
    controlPrefix: "T",
    summary:
      "Drafts the technical-architecture assessment — integration, resilience, data-flow design — grounded in MP-T.",
  },
  "responsible-ai": {
    name: "Responsible AI Review Agent",
    policyId: "MP-R v4",
    controlPrefix: "R",
    summary:
      "Drafts the Responsible AI assessment — model cards, fairness testing, and eval-quality expectations — grounded in MP-R.",
  },
  security: {
    name: "Security Review Agent",
    policyId: "MP-S v3",
    controlPrefix: "S",
    summary:
      "Drafts the security assessment — threat model, access control, secrets & logging — grounded in MP-S.",
  },
  "privacy-hipaa": {
    name: "Privacy / HIPAA Review Agent",
    policyId: "MP-H v3",
    controlPrefix: "H",
    summary:
      "Drafts the Privacy/HIPAA assessment — DPIA, PHI minimization, BAA, de-identification — grounded in MP-H.",
  },
  "clinical-safety": {
    name: "Clinical Safety Review Agent",
    policyId: "MP-C v3",
    controlPrefix: "C",
    summary:
      "Drafts the clinical-safety assessment — clinician-in-the-loop, adverse-event monitoring — grounded in MP-C.",
  },
  "data-governance": {
    name: "Data Governance Review Agent",
    policyId: "MP-D v2",
    controlPrefix: "D",
    summary:
      "Drafts the data-governance assessment — lineage, retention, quality & access — grounded in MP-D.",
  },
};

// Domain order mirrors the control catalog / seed-spec §3.
const DOMAIN_ORDER: GovernanceDomain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

// Invert the reviewer→domain assignment (via the authoritative
// `reviewerDomainFor`) so the registry's accountable persona per domain always
// matches the sign/return assignment authz (M2.5 inc.3).
const PERSONA_BY_DOMAIN: Partial<Record<GovernanceDomain, PersonaKey>> = {};
for (const personaKey of Object.keys(ACTOR_DIRECTORY) as PersonaKey[]) {
  const domain = reviewerDomainFor(personaKey);
  if (domain) PERSONA_BY_DOMAIN[domain as GovernanceDomain] = personaKey;
}

const TRACK_FILENAME: Record<GovernanceDomain, string> = {
  legal: "legal.md",
  procurement: "procurement.md",
  "tech-architecture": "tech-architecture.md",
  "responsible-ai": "responsible-ai.md",
  security: "security.md",
  "privacy-hipaa": "privacy-hipaa.md",
  "clinical-safety": "clinical-safety.md",
  "data-governance": "data-governance.md",
};

/** The 8 per-domain review agents (AgentPort.draftReview). */
export const REVIEW_AGENTS: GovernanceAgent[] = DOMAIN_ORDER.map((domain) => {
  const meta = DOMAIN_META[domain];
  const personaKey = PERSONA_BY_DOMAIN[domain] ?? null;
  return {
    id: `reviewer-${domain}`,
    name: meta.name,
    kind: "reviewer",
    capability: "draftReview",
    domain,
    accountablePersona: personaKey,
    accountablePersonaName: personaKey ? ACTOR_DIRECTORY[personaKey]?.name ?? null : null,
    policyId: meta.policyId,
    controlPrefix: meta.controlPrefix,
    instructionsPath: `agents/reviewer/tracks/${TRACK_FILENAME[domain]}`,
    summary: meta.summary,
  };
});

/** Lifecycle + oversight agents (cross-cutting, not per-domain). */
export const LIFECYCLE_AGENTS: GovernanceAgent[] = [
  {
    id: "triage",
    name: "Triage Narration Agent",
    kind: "triage",
    capability: "triageAssist",
    domain: null,
    accountablePersona: null,
    accountablePersonaName: null,
    policyId: null,
    controlPrefix: null,
    instructionsPath: "agents/triage/instructions.md",
    summary:
      "Narrates the tier + required-domains routing the deterministic rule engine already computed. Never sets or overrides a tier.",
  },
  {
    id: "intake",
    name: "Intake Interview Agent",
    kind: "intake",
    capability: "intakeInterview",
    domain: null,
    accountablePersona: null,
    accountablePersonaName: null,
    policyId: null,
    controlPrefix: null,
    instructionsPath: "agents/intake/instructions.md",
    summary:
      "Conversational intake — asks the overlay questions, flags gaps, and hands off. Never invents an answer for the requester.",
  },
  {
    id: "completeness",
    name: "Completeness Check Agent",
    kind: "completeness",
    capability: "checkCompleteness",
    domain: null,
    accountablePersona: null,
    accountablePersonaName: null,
    policyId: null,
    controlPrefix: null,
    instructionsPath: "lib/intake/completeness.ts (authoritative) + inline prompt",
    summary:
      "Flags missing or inconsistent required intake evidence as advisory gaps. Authoritative completeness is deterministic code.",
  },
];

export const OVERSIGHT_AGENTS: GovernanceAgent[] = [
  {
    id: "auditor",
    name: "Ask-the-Auditor Agent",
    kind: "auditor",
    capability: "auditorAnswer",
    domain: null,
    accountablePersona: null,
    accountablePersonaName: null,
    policyId: null,
    controlPrefix: null,
    instructionsPath: "agents/auditor/instructions.md",
    summary:
      "Answers natural-language audit questions grounded ONLY in the structured audit log; cites the events it used. Never editorializes.",
  },
  {
    id: "ops-monitor",
    name: "Deployment Monitor Agent",
    kind: "monitor",
    capability: "monitor",
    domain: null,
    accountablePersona: null,
    accountablePersonaName: null,
    policyId: "Q-01 (eval-quality floor)",
    controlPrefix: "Q",
    instructionsPath: "agents/ops-monitor/instructions.md",
    summary:
      "Watches deployment eval-quality telemetry and surfaces breaches. The pause + reassessment is a deterministic, idempotent code action, not the agent's call.",
  },
];

/** Every governance agent, in display order (reviewers, lifecycle, oversight). */
export const GOVERNANCE_AGENTS: GovernanceAgent[] = [
  ...REVIEW_AGENTS,
  ...LIFECYCLE_AGENTS,
  ...OVERSIGHT_AGENTS,
];

/** Runtime status of the agent adapter (which one `getAgentPort()` will use). */
export interface AgentRuntimeStatus {
  connected: boolean;
  adapter: "openai" | "mock";
  model: string;
  detail: string;
}

export function agentRuntimeStatus(): AgentRuntimeStatus {
  const hasKey = !!process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-5.1";
  return hasKey
    ? {
        connected: true,
        adapter: "openai",
        model,
        detail: `OpenAI adapter (${model}) — live structured drafts via generateText + Output.object.`,
      }
    : {
        connected: false,
        adapter: "mock",
        model,
        detail:
          "Deterministic mock adapter (no OPENAI_API_KEY) — drafts are canned but citations and control ids are real, so the demo runs with zero external calls.",
      };
}
