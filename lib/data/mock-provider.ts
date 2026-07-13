// Deterministic mock DataProvider — fixtures encode docs/seed-spec.md by hand.
// No randomness, no Date.now(), no file/network I/O. Every tier below is
// hand-verified against lib/triage/rules.ts#deriveTier (see the comment above
// each initiative) and cross-checked with lib/triage/routing.ts#requiredDomains
// for domainsRequired counts. This file is UI-dev/test fixture data only —
// lib/data/db-provider.ts (not yet built) will replace it once DATABASE_URL
// is wired; both must satisfy the same DataProvider contract from provider.ts.
import type { Domain, OverlayFlags, Tier } from "@/lib/domain/types";
import { deriveTier } from "@/lib/triage/rules";
import { requiredDomains } from "@/lib/triage/routing";
import type { DataProvider, WorkspaceScopedReadOptions } from "./provider";
import type {
  AuditEventRow,
  AuditQueryRow,
  CannedAuditQueryId,
  ControlRow,
  DecisionRow,
  DeploymentRow,
  InitiativeDetail,
  InitiativeSummary,
  OutcomeMetrics,
  ReviewRow,
  TelemetrySeries,
} from "./dto";

// ---------------------------------------------------------------------------
// Deterministic helpers (pure functions of day index — no wall clock, no RNG)
// ---------------------------------------------------------------------------

const BASE_DATE = "2026-07-01T00:00:00.000Z";
const BASE_MS = Date.parse(BASE_DATE);
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date string for `base + offsetDays` (may be negative). */
function isoAt(offsetDays: number): string {
  return new Date(BASE_MS + offsetDays * DAY_MS).toISOString();
}

/** `n` consecutive daily ISO timestamps starting at `base + startOffsetDays`. */
function dailyDates(startOffsetDays: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => isoAt(startOffsetDays + i));
}

/** Linear ramp from `start` to `end` across `n` points (index 0..n-1). */
function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + step * i);
}

/** Day-of-week for `base + offsetDays`, 0=Sun..6=Sat, derived from the fixed base date (a Wednesday). */
function dayOfWeek(offsetDays: number): number {
  return new Date(BASE_MS + offsetDays * DAY_MS).getUTCDay();
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function series(
  kind: TelemetrySeries["kind"],
  startOffsetDays: number,
  values: number[],
  threshold: number | null,
): TelemetrySeries {
  const dates = dailyDates(startOffsetDays, values.length);
  return {
    kind,
    points: dates.map((ts, i) => ({ ts, value: values[i] })),
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Actors (seed-spec §1)
// ---------------------------------------------------------------------------

const PRIYA = "Priya Raman";
const DAN = "Dan Kowalski";
const ELENA = "Dr. Elena Vasquez";
const MARCUS = "Marcus Webb";
const SOFIA = "Sofia Grant";
const JAMES = "James Liu";
const ANGELA = "Angela Torres";
const RAY = "Ray Chen";
const NIA = "Nia Okafor";

// Reviewer-by-domain assignment used across seeded ReviewRows (seed-spec §1).
const REVIEWER_BY_DOMAIN: Record<Domain, string> = {
  "clinical-safety": ELENA,
  "privacy-hipaa": MARCUS,
  "responsible-ai": SOFIA,
  legal: JAMES,
  procurement: NIA,
  "tech-architecture": NIA,
  security: NIA,
  "data-governance": NIA,
};

const DOMAIN_LABEL: Record<Domain, string> = {
  legal: "Legal",
  procurement: "Procurement",
  "tech-architecture": "Tech Architecture",
  "responsible-ai": "Responsible AI",
  security: "Security",
  "privacy-hipaa": "Privacy/HIPAA",
  "clinical-safety": "Clinical Safety",
  "data-governance": "Data Governance",
};

// ---------------------------------------------------------------------------
// Control catalog (seed-spec §3): 16 domain controls + Q-01 runtime control.
// policySource format "MP-<letter> vN §MP-<letter>-<section>" per
// docs/policies/INDEX.md control-to-section cross-reference.
// ---------------------------------------------------------------------------

interface CatalogEntry {
  id: string;
  name: string;
  domain: Domain;
  policySource: string;
  // M4 catalog fields (control_definitions columns) — hand-picked plausible,
  // deterministic values per control; no randomness, mirrors real-schema shape.
  owner: string;
  cadence: string;
  enforcementMode: "monitor" | "gate" | "block";
  remediationOwner: string | null;
  requiredEvidence: string;
}

const CONTROL_CATALOG: CatalogEntry[] = [
  { id: "L-01", name: "Vendor contract AI addendum", domain: "legal", policySource: "MP-L v3 §MP-L-2", owner: JAMES, cadence: "per-contract", enforcementMode: "gate", remediationOwner: JAMES, requiredEvidence: "Signed AI addendum on file" },
  { id: "L-02", name: "Marketing-claims review", domain: "legal", policySource: "MP-L v3 §MP-L-3", owner: JAMES, cadence: "per-campaign", enforcementMode: "monitor", remediationOwner: JAMES, requiredEvidence: "Legal sign-off memo" },
  { id: "P-01", name: "Vendor risk assessment", domain: "procurement", policySource: "MP-P v2 §MP-P-2", owner: NIA, cadence: "annual", enforcementMode: "gate", remediationOwner: NIA, requiredEvidence: "Completed vendor risk questionnaire" },
  { id: "P-02", name: "SaaS data-residency attestation", domain: "procurement", policySource: "MP-P v2 §MP-P-3", owner: NIA, cadence: "annual", enforcementMode: "monitor", remediationOwner: NIA, requiredEvidence: "Vendor data-residency attestation letter" },
  { id: "T-01", name: "Architecture review record", domain: "tech-architecture", policySource: "MP-T v2 §MP-T-2", owner: RAY, cadence: "per-deployment", enforcementMode: "gate", remediationOwner: RAY, requiredEvidence: "Architecture review record (ARB sign-off)" },
  { id: "T-02", name: "Disaster-recovery plan", domain: "tech-architecture", policySource: "MP-T v2 §MP-T-3", owner: RAY, cadence: "annual", enforcementMode: "monitor", remediationOwner: RAY, requiredEvidence: "DR runbook + last test date" },
  { id: "R-01", name: "Bias & fairness testing", domain: "responsible-ai", policySource: "MP-R v4 §MP-R-2", owner: SOFIA, cadence: "per-deployment", enforcementMode: "gate", remediationOwner: SOFIA, requiredEvidence: "Fairness test report" },
  { id: "R-02", name: "Model card published", domain: "responsible-ai", policySource: "MP-R v4 §MP-R-3", owner: SOFIA, cadence: "per-deployment", enforcementMode: "monitor", remediationOwner: SOFIA, requiredEvidence: "Published model card URL" },
  { id: "S-01", name: "Pen test / threat model", domain: "security", policySource: "MP-S v3 §MP-S-2", owner: DAN, cadence: "annual", enforcementMode: "block", remediationOwner: DAN, requiredEvidence: "Pen test report + threat model doc" },
  { id: "S-02", name: "Secrets & access review", domain: "security", policySource: "MP-S v3 §MP-S-3", owner: DAN, cadence: "quarterly", enforcementMode: "gate", remediationOwner: DAN, requiredEvidence: "Access review sign-off" },
  { id: "H-01", name: "PHI minimization & BAA", domain: "privacy-hipaa", policySource: "MP-H v3 §MP-H-2", owner: MARCUS, cadence: "per-deployment", enforcementMode: "block", remediationOwner: MARCUS, requiredEvidence: "Executed BAA + minimization review" },
  { id: "H-02", name: "De-identification validation", domain: "privacy-hipaa", policySource: "MP-H v3 §MP-H-3", owner: MARCUS, cadence: "quarterly", enforcementMode: "gate", remediationOwner: MARCUS, requiredEvidence: "De-identification validation report" },
  { id: "C-01", name: "Clinician-in-the-loop protocol", domain: "clinical-safety", policySource: "MP-C v3 §MP-C-2", owner: ELENA, cadence: "per-deployment", enforcementMode: "block", remediationOwner: ELENA, requiredEvidence: "Clinician-in-the-loop protocol doc" },
  { id: "C-02", name: "Adverse-event monitoring", domain: "clinical-safety", policySource: "MP-C v3 §MP-C-3", owner: ELENA, cadence: "quarterly", enforcementMode: "gate", remediationOwner: ELENA, requiredEvidence: "Adverse-event monitoring log" },
  { id: "D-01", name: "Data lineage & sourcing approval", domain: "data-governance", policySource: "MP-D v2 §MP-D-2", owner: PRIYA, cadence: "per-deployment", enforcementMode: "gate", remediationOwner: PRIYA, requiredEvidence: "Data lineage & sourcing approval memo" },
  { id: "D-02", name: "Retention & disposal schedule", domain: "data-governance", policySource: "MP-D v2 §MP-D-3", owner: PRIYA, cadence: "annual", enforcementMode: "monitor", remediationOwner: PRIYA, requiredEvidence: "Retention & disposal schedule doc" },
];

// Q-01 default threshold: tier-specific defaults are High=0.08, Critical=0.05
// (seed-spec §3). controlCatalog() (the flat 17-row catalog consumed by
// /admin and the global Controls catalog view) returns the single global
// default of 0.08 for Q-01 since the catalog is tier-agnostic; per-initiative
// ControlRow entries on Critical-tier initiatives use the tier-specific 0.05
// value instead (see buildControls() below) — documented here as the one
// deliberate divergence between the flat catalog and per-initiative rows.
const Q01_DEFAULT_THRESHOLD = 0.08;
const Q01_CRITICAL_THRESHOLD = 0.05;

// ---------------------------------------------------------------------------
// Initiative fixture shape
// ---------------------------------------------------------------------------

type LifecycleStateName =
  | "intake_draft"
  | "submitted"
  | "triaged"
  | "in_review"
  | "fast_lane_approved"
  | "approved"
  | "conditionally_approved"
  | "rejected"
  | "deployed"
  | "paused"
  | "re_review"
  | "retired";

interface InitiativeFixture {
  slug: string;
  title: string;
  flags: OverlayFlags;
  tier: Tier; // hand-verified below against deriveTier()
  state: LifecycleStateName;
  storyline: string;
  requester: string;
  accountableApprover: string | null;
  domainsSigned: number;
  overdue: boolean;
  // Workspace isolation foundation (M2.5 inc.2a) — absent/undefined on every
  // seeded fixture below, i.e. all 12 behave as workspace_id IS NULL
  // (seeded/public), matching the real DB provider's seeded rows.
  workspaceId?: string | null;
}

// Overlay-flag order per seed-spec §2.1: PHI, member-facing, care-coverage,
// vendor-hosted, human-in-loop, individual-impact.
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

const INITIATIVES: InitiativeFixture[] = [
  {
    // #1: careCoverage=Y, humanInLoop=N -> rule 1 -> Critical. Hand-check: OK.
    slug: "prior-auth-summarizer",
    title: "Prior-Auth Clinical Summarizer",
    flags: flags(true, true, true, true, false, true),
    tier: "critical",
    state: "intake_draft",
    storyline: "champion",
    requester: PRIYA,
    accountableApprover: null,
    domainsSigned: 0,
    overdue: false,
  },
  {
    // #2: no PHI/memberFacing/careCoverage/individualImpact -> rule 7 -> Low. Hand-check: OK.
    slug: "marketing-ab-tester",
    title: "Marketing Copy A/B Tester",
    flags: flags(false, false, false, true, true, false),
    tier: "low",
    state: "deployed",
    storyline: "fast-lane",
    requester: DAN,
    accountableApprover: ANGELA,
    domainsSigned: 4,
    overdue: false,
  },
  {
    // #3: PHI=Y -> rule 3 -> High. Hand-check: OK.
    slug: "social-sentiment-miner",
    title: "Member Social-Media Sentiment Miner",
    flags: flags(true, true, false, true, true, false),
    tier: "high",
    state: "rejected",
    storyline: "rejected",
    requester: PRIYA,
    accountableApprover: ANGELA,
    domainsSigned: 5,
    overdue: false,
  },
  {
    // #4: PHI=Y -> rule 3 -> High. Hand-check: OK.
    slug: "member-chat-copilot",
    title: "Member Services Chat Copilot",
    flags: flags(true, true, false, false, true, false),
    tier: "high",
    state: "deployed",
    storyline: "breach",
    requester: PRIYA,
    accountableApprover: ANGELA,
    domainsSigned: 6,
    overdue: false,
  },
  {
    // #5: careCoverage=Y, humanInLoop=N -> rule 1 -> Critical. Hand-check: OK.
    slug: "pa-correspondence-model",
    title: "Prior-Auth Correspondence Drafting Model",
    flags: flags(true, false, true, false, false, true),
    tier: "critical",
    state: "deployed",
    storyline: "promotion-gate",
    requester: PRIYA,
    accountableApprover: ANGELA,
    domainsSigned: 8,
    overdue: false,
  },
  {
    // #6: careCoverage=Y, humanInLoop=Y -> rule 2 -> High. Hand-check: OK.
    slug: "claims-ocr-coder",
    title: "Claims Document OCR + Coding Model",
    flags: flags(true, false, true, false, true, true),
    tier: "high",
    state: "deployed",
    storyline: "gpu",
    requester: DAN,
    accountableApprover: ANGELA,
    domainsSigned: 7,
    overdue: false,
  },
  {
    // #7: no flags true except humanInLoop/individualImpact -> rule 5 -> Medium. Hand-check: OK.
    // Sanity fixture: Medium + no PHI/vendor/careCoverage -> exactly base 5 domains.
    slug: "provider-dedup-agent",
    title: "Provider Directory Dedup Agent",
    flags: flags(false, false, false, false, true, true),
    tier: "medium",
    state: "in_review",
    storyline: "mid-pipeline",
    requester: DAN,
    accountableApprover: null,
    domainsSigned: 3,
    overdue: false,
  },
  {
    // #8: careCoverage=Y, humanInLoop=N -> rule 1 -> Critical. Hand-check: OK.
    slug: "nurse-triage-summarizer",
    title: "Nurse Triage Line Summarizer",
    flags: flags(true, false, true, false, false, true),
    tier: "critical",
    state: "conditionally_approved",
    storyline: "conditional",
    requester: PRIYA,
    accountableApprover: ANGELA,
    domainsSigned: 8,
    overdue: false,
  },
  {
    // #9: PHI=Y -> rule 3 -> High. Hand-check: OK.
    slug: "formulary-qa-bot",
    title: "Member Formulary Q&A Bot",
    flags: flags(true, true, false, true, false, false),
    tier: "high",
    state: "in_review",
    storyline: "returned",
    requester: DAN,
    accountableApprover: null,
    domainsSigned: 4,
    overdue: true,
  },
  {
    // #10: careCoverage=Y, humanInLoop=Y -> rule 2 -> High. Hand-check: OK.
    slug: "fwa-anomaly-detector",
    title: "Fraud, Waste & Abuse Anomaly Detector",
    flags: flags(true, false, true, false, true, true),
    tier: "high",
    state: "deployed",
    storyline: "overdue",
    requester: NIA,
    accountableApprover: ANGELA,
    domainsSigned: 7,
    overdue: true,
  },
  {
    // #11: no PHI/memberFacing/careCoverage, individualImpact=Y -> rule 5 -> Medium. Hand-check: OK.
    slug: "hr-resume-screener",
    title: "HR Résumé Screener",
    flags: flags(false, false, false, true, true, true),
    tier: "medium",
    state: "approved",
    storyline: "exception",
    requester: DAN,
    accountableApprover: ANGELA,
    domainsSigned: 6,
    overdue: true,
  },
  {
    // #12: no PHI/memberFacing/careCoverage, individualImpact=Y -> rule 5 -> Medium. Hand-check: OK.
    slug: "callcenter-qa-scorer",
    title: "Call Center QA Auto-Scorer",
    flags: flags(false, false, false, false, true, true),
    tier: "medium",
    state: "deployed",
    storyline: "healthy",
    requester: NIA,
    accountableApprover: ANGELA,
    domainsSigned: 5,
    overdue: false,
  },
];

// Internal consistency check: fail fast (at module load, dev/test time) if
// any hand-authored tier ever drifts from lib/triage/rules.ts. Keeps this
// fixture file and the rules module from silently diverging.
for (const init of INITIATIVES) {
  const derived = deriveTier(init.flags);
  if (derived !== init.tier) {
    throw new Error(
      `mock-provider fixture drift: ${init.slug} hand-coded tier "${init.tier}" but deriveTier() returns "${derived}"`,
    );
  }
}

function domainsRequiredFor(init: InitiativeFixture): Domain[] {
  return [...requiredDomains(init.tier, init.flags)].sort();
}

// ---------------------------------------------------------------------------
// Reviews, decisions, controls, telemetry, deployments, events per initiative
// ---------------------------------------------------------------------------

function reviewStatusFor(
  init: InitiativeFixture,
  domain: Domain,
  index: number,
): ReviewRow["status"] {
  if (init.slug === "formulary-qa-bot" && domain === "responsible-ai") {
    return "returned";
  }
  if (index < init.domainsSigned) {
    return "signed";
  }
  if (init.state === "intake_draft") {
    return "pending";
  }
  return index === init.domainsSigned ? "drafted" : "pending";
}

function buildReviews(init: InitiativeFixture): ReviewRow[] {
  const domains = domainsRequiredFor(init);
  return domains.map((domain, index) => {
    const status = reviewStatusFor(init, domain, index);
    const reviewer = status === "pending" ? null : REVIEWER_BY_DOMAIN[domain];
    const signedAt = status === "signed" ? isoAt(-20 + index * 2) : null;
    // When this review entered the queue — spread across each cycle's domains
    // so the workbench aging view shows a believable fresh -> overdue gradient
    // (synthetic demo data). Signed rows carry it for tooltip/turnaround only.
    const createdAt = isoAt(5 - index * 3);
    let draftMd: string | null = null;
    let citations: string[] = [];

    if (init.storyline === "champion") {
      draftMd = null;
      citations = [];
    } else if (init.slug === "formulary-qa-bot" && domain === "responsible-ai") {
      draftMd =
        "Draft returned: bias-testing evidence for the formulary Q&A response set is missing " +
        "(no R-01 test report on file for this deployment). Cannot sign off on Responsible AI " +
        "criteria until bias/fairness testing evidence is attached.";
      citations = ["MP-R-2.4", "MP-R-7"];
    } else if (init.slug === "social-sentiment-miner") {
      draftMd =
        `Draft assessment for ${DOMAIN_LABEL[domain]}: initiative performs unconsented inference ` +
        "over monitored member/public social communications; recommend rejection on this domain's grounds.";
      citations =
        domain === "privacy-hipaa"
          ? ["MP-H-5.1(b)", "MP-H-5.2"]
          : domain === "responsible-ai"
            ? ["MP-R-5.1(a)", "MP-R-5.2"]
            : domain === "legal"
              ? ["MP-L-6.1(b)", "MP-L-6.2"]
              : [];
    } else if (status === "signed" || status === "drafted") {
      draftMd = `${DOMAIN_LABEL[domain]} review draft for ${init.title}: reviewed against champion-class and standard criteria; no outstanding findings.`;
      citations = [`MP-${domain === "privacy-hipaa" ? "H" : domain === "clinical-safety" ? "C" : domain === "responsible-ai" ? "R" : domain === "tech-architecture" ? "T" : domain === "data-governance" ? "D" : domain === "procurement" ? "P" : domain === "security" ? "S" : "L"}-2`];
    }

    return {
      domain,
      status,
      reviewer,
      createdAt,
      signedAt,
      draftMd,
      citations,
    };
  });
}

function buildDecisions(init: InitiativeFixture): DecisionRow[] {
  switch (init.storyline) {
    case "fast-lane":
      return [
        {
          type: "fast_lane_approved",
          approver: ANGELA,
          at: isoAt(-45),
          conditions: [],
          citations: ["FL-2.1", "FL-3.1", "FL-3.2", "FL-4"],
        },
      ];
    case "rejected":
      return [
        {
          type: "rejected",
          approver: ANGELA,
          at: isoAt(-40),
          conditions: [],
          citations: ["MP-H-5.1(b)", "MP-H-5.2", "MP-R-5.1(a)", "MP-R-5.2", "MP-L-6.1(b)", "MP-L-6.2"],
        },
      ];
    case "conditional":
      return [
        {
          type: "conditionally_approved",
          approver: ANGELA,
          at: isoAt(-25),
          conditions: [
            { text: "Human-review sampling rate maintained at minimum 20% of outputs", controlId: "C-01" },
            { text: "Escalation protocol refinement completed within 60 days", controlId: "C-02" },
          ],
          citations: ["MP-C-4.2", "MP-C-5.2"],
        },
      ];
    case "breach":
    case "promotion-gate":
    case "gpu":
    case "overdue":
    case "healthy":
      return [
        {
          type: "approved",
          approver: ANGELA,
          at: isoAt(-60),
          conditions: [],
          citations: [],
        },
      ];
    case "exception":
      return [
        {
          type: "approved",
          approver: ANGELA,
          at: isoAt(-90),
          conditions: [],
          citations: ["MP-R-2.3"],
        },
      ];
    case "mid-pipeline":
    case "champion":
    default:
      return [];
  }
}

function statusForCatalogControl(
  entry: CatalogEntry,
  init: InitiativeFixture,
): ControlRow["status"] {
  if (init.slug === "hr-resume-screener" && entry.id === "R-01") {
    return "exception_requested";
  }
  if (init.slug === "fwa-anomaly-detector" && entry.id === "D-02") {
    return "overdue";
  }
  if (init.slug === "formulary-qa-bot" && entry.id === "R-01") {
    return "overdue";
  }
  if (init.state === "intake_draft") {
    return "pending";
  }
  if (init.state === "rejected") {
    return "pending";
  }
  return "met";
}

function applicableControls(init: InitiativeFixture): CatalogEntry[] {
  const domains = new Set(domainsRequiredFor(init));
  return CONTROL_CATALOG.filter((c) => domains.has(c.domain));
}

function buildControls(init: InitiativeFixture): ControlRow[] {
  const rows: ControlRow[] = applicableControls(init).map((entry) => ({
    id: entry.id,
    name: entry.name,
    domain: entry.domain,
    status: statusForCatalogControl(entry, init),
    policySource: entry.policySource,
    threshold: null,
    evidence:
      statusForCatalogControl(entry, init) === "met"
        ? `${entry.name} evidence on file`
        : statusForCatalogControl(entry, init) === "exception_requested"
          ? "Exception request pending Program Office review"
          : statusForCatalogControl(entry, init) === "overdue"
            ? "Evidence stale or missing — remediation owner assigned"
            : null,
  }));

  // Q-01 runtime control: only meaningful for initiatives with an
  // eval_hallucination series (LLM-based deployed/operating initiatives).
  // GPU-only (#6 claims-ocr-coder) has no eval_hallucination series and
  // therefore no Q-01 row — Q-01 applies only to hallucination-monitored
  // initiatives.
  const hasEval = ["breach", "promotion-gate", "healthy"].includes(init.storyline);
  if (hasEval) {
    const threshold = init.tier === "critical" ? Q01_CRITICAL_THRESHOLD : Q01_DEFAULT_THRESHOLD;
    rows.push({
      id: "Q-01",
      name: "Eval quality floor",
      domain: "runtime",
      status: init.storyline === "breach" ? "breached" : "met",
      policySource: null,
      threshold,
      evidence:
        init.storyline === "breach"
          ? "Hallucination rate sustained above threshold for 3+ consecutive points"
          : "Hallucination rate within threshold band",
    });
  }

  return rows;
}

function buildTelemetry(init: InitiativeFixture): TelemetrySeries[] {
  const out: TelemetrySeries[] = [];

  if (init.slug === "member-chat-copilot") {
    // eval_hallucination = 0.045 + 0.0035*day. Day 10 equals 0.08 exactly
    // (NOT strictly above); the first point strictly above threshold is day
    // 11 (0.0835). With the 3-point sustained-breach window, the breach
    // fires with the day-13 observation (days 11, 12, 13 all strictly above).
    const evalValues = Array.from({ length: 30 }, (_, day) => round(0.045 + 0.0035 * day, 4));
    out.push(series("eval_hallucination", 0, evalValues, 0.08));
    // cost ramps $80 -> $140 across 30 days.
    out.push(series("cost_tokens_usd_day", 0, linspace(80, 140, 30).map((v) => round(v, 2)), null));
  } else if (init.slug === "pa-correspondence-model") {
    // Flat healthy band 0.03-0.05 via a fixed small oscillation (pure fn of day).
    const evalValues = Array.from({ length: 30 }, (_, day) => round(0.04 + 0.01 * Math.sin(day / 3), 4));
    out.push(series("eval_hallucination", 0, evalValues, 0.05));
    out.push(series("cost_tokens_usd_day", 0, linspace(60, 75, 30).map((v) => round(v, 2)), null));
  } else if (init.slug === "callcenter-qa-scorer") {
    const evalValues = Array.from({ length: 30 }, (_, day) => round(0.035 + 0.01 * Math.sin(day / 4), 4));
    out.push(series("eval_hallucination", 0, evalValues, 0.08));
    out.push(series("cost_tokens_usd_day", 0, linspace(20, 25, 30).map((v) => round(v, 2)), null));
  } else if (init.slug === "claims-ocr-coder") {
    // gpu_util_pct ONLY for this initiative: weekday 55-85%, weekend 20-30%, quota 80%.
    const gpuValues = Array.from({ length: 30 }, (_, day) => {
      const dow = dayOfWeek(day);
      const isWeekend = dow === 0 || dow === 6;
      return isWeekend
        ? round(25 + 5 * Math.sin(day), 1)
        : round(70 + 15 * Math.sin(day / 2), 1);
    });
    out.push(series("gpu_util_pct", 0, gpuValues, 80));
    out.push(series("cost_tokens_usd_day", 0, linspace(40, 55, 30).map((v) => round(v, 2)), null));
  } else if (init.slug === "fwa-anomaly-detector") {
    // Pre-LLM model: cost series only, no eval series.
    out.push(series("cost_tokens_usd_day", 0, linspace(15, 18, 30).map((v) => round(v, 2)), null));
  } else if (init.slug === "marketing-ab-tester" || init.slug === "hr-resume-screener") {
    out.push(series("cost_tokens_usd_day", 0, linspace(10, 14, 30).map((v) => round(v, 2)), null));
  }

  return out;
}

function buildDeployments(init: InitiativeFixture): DeploymentRow[] {
  switch (init.slug) {
    case "marketing-ab-tester":
      return [{ version: "v1.0", status: "deployed", at: isoAt(-44) }];
    case "member-chat-copilot":
      return [{ version: "v1.2", status: "deployed", at: isoAt(-30) }];
    case "pa-correspondence-model":
      return [
        { version: "v2.0", status: "deployed", at: isoAt(-70) },
        { version: "v2.1", status: "awaiting_promotion_signoff", at: isoAt(-5) },
      ];
    case "claims-ocr-coder":
      return [{ version: "v1.4", status: "deployed", at: isoAt(-100) }];
    case "fwa-anomaly-detector":
      return [{ version: "v3.1", status: "deployed", at: isoAt(-420) }];
    case "hr-resume-screener":
      return [{ version: "v1.1", status: "deployed", at: isoAt(-80) }];
    case "callcenter-qa-scorer":
      return [{ version: "v2.2", status: "deployed", at: isoAt(-200) }];
    default:
      return [];
  }
}

function buildEvents(init: InitiativeFixture): AuditEventRow[] {
  const events: AuditEventRow[] = [];
  const flagSummary = `PHI=${init.flags.phi ? "Y" : "N"}, member-facing=${init.flags.memberFacing ? "Y" : "N"}, care-coverage=${init.flags.careCoverageInfluence ? "Y" : "N"}, vendor-hosted=${init.flags.vendorHosted ? "Y" : "N"}, human-in-loop=${init.flags.humanInLoop ? "Y" : "N"}, individual-impact=${init.flags.individualImpact ? "Y" : "N"}`;

  if (init.state === "intake_draft") {
    events.push({
      ts: isoAt(-1),
      actor: init.requester,
      actorRole: "requester",
      action: "intake_started",
      detail: "Intake draft started; not yet submitted.",
    });
    return events;
  }

  events.push({
    ts: isoAt(-60),
    actor: init.requester,
    actorRole: "requester",
    action: "intake_submitted",
    detail: `Intake submitted for "${init.title}".`,
  });
  events.push({
    ts: isoAt(-59),
    actor: "system",
    actorRole: "system",
    action: "triage_classified",
    detail: `Triage: ${flagSummary} -> ${init.tier}.`,
  });

  const reviews = buildReviews(init);
  for (const r of reviews) {
    if (r.status === "signed" && r.signedAt) {
      events.push({
        ts: r.signedAt,
        actor: r.reviewer ?? "unknown",
        actorRole: "reviewer",
        action: "review_signed",
        detail: `${DOMAIN_LABEL[r.domain]} review signed.`,
      });
    } else if (r.status === "returned") {
      events.push({
        ts: isoAt(-15),
        actor: r.reviewer ?? "unknown",
        actorRole: "reviewer",
        action: "review_returned",
        detail: `${DOMAIN_LABEL[r.domain]} review returned: missing bias-testing evidence (MP-R-2.4).`,
      });
    } else if (r.status === "drafted") {
      events.push({
        ts: isoAt(-10),
        actor: r.reviewer ?? "unknown",
        actorRole: "reviewer",
        action: "review_drafted",
        detail: `${DOMAIN_LABEL[r.domain]} review drafted, awaiting signature.`,
      });
    }
  }

  const decisions = buildDecisions(init);
  for (const d of decisions) {
    events.push({
      ts: d.at,
      actor: d.approver,
      actorRole: "approver",
      action: "decision_recorded",
      detail: `Decision: ${d.type} by ${d.approver}.`,
    });
  }

  for (const dep of buildDeployments(init)) {
    events.push({
      ts: dep.at,
      actor: "system",
      actorRole: "system",
      action: "deployment_created",
      detail: `Deployment ${dep.version} created (${dep.status}).`,
    });
  }

  if (init.slug === "fwa-anomaly-detector") {
    events.push({
      ts: isoAt(-14),
      actor: "system",
      actorRole: "system",
      action: "periodic_review_overdue",
      detail: "Periodic review cadence lapsed (MP-D-3.2 / MP-D-7.2) — remediation owner: Nia Okafor.",
    });
  }

  if (init.slug === "hr-resume-screener") {
    events.push({
      ts: isoAt(-10),
      actor: DAN,
      actorRole: "requester",
      action: "exception_requested",
      detail: "Bias-audit cadence waiver requested (MP-R-2.3) — pending Program Office review.",
    });
  }

  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return events;
}

// The one historical admin threshold-change event (base-30d, Ray Chen,
// 0.10 -> 0.08, "Q2 quality initiative") — foreshadows #4's live breach.
// Scoped globally (not to a single initiative) since Q-01 is a
// cross-portfolio runtime control, but surfaced on member-chat-copilot's
// audit tab since that's the initiative the threshold change foreshadows.
const Q01_THRESHOLD_CHANGE_EVENT: AuditEventRow = {
  ts: isoAt(-30),
  actor: RAY,
  actorRole: "admin",
  action: "control_threshold_changed",
  detail: "Q-01 Eval quality floor threshold tightened from 0.10 to 0.08. Reason: \"Q2 quality initiative\".",
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Deterministic per-slug "time in current state" for the demo (0..-13d from BASE). */
function seededUpdatedAt(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h + slug.charCodeAt(i)) % 14;
  return isoAt(-h);
}

function toSummary(init: InitiativeFixture): InitiativeSummary {
  const domains = domainsRequiredFor(init);
  return {
    slug: init.slug,
    title: init.title,
    tier: init.tier,
    state: init.state,
    flags: init.flags,
    requester: init.requester,
    accountableApprover: init.accountableApprover,
    domainsRequired: domains.length,
    domainsSigned: init.domainsSigned,
    overdue: init.overdue,
    storyline: init.storyline,
    updatedAt: seededUpdatedAt(init.slug),
  };
}

function toDetail(init: InitiativeFixture): InitiativeDetail {
  const summary = toSummary(init);
  const intake =
    init.state === "intake_draft"
      ? {
          version: 1,
          submitted: false,
          fields: {
            title: init.title,
            description:
              "Summarizes prior-authorization clinical documentation for reviewer efficiency. (Draft — not yet submitted.)",
            phi: init.flags.phi,
            memberFacing: init.flags.memberFacing,
            careCoverageInfluence: init.flags.careCoverageInfluence,
            vendorHosted: init.flags.vendorHosted,
            humanInLoop: init.flags.humanInLoop,
            individualImpact: init.flags.individualImpact,
            "data.retentionIntent": null,
          },
          missing: ["data.retentionIntent"],
        }
      : {
          version: 1,
          submitted: true,
          fields: {
            title: init.title,
            description: `${init.title} — submitted intake record.`,
            phi: init.flags.phi,
            memberFacing: init.flags.memberFacing,
            careCoverageInfluence: init.flags.careCoverageInfluence,
            vendorHosted: init.flags.vendorHosted,
            humanInLoop: init.flags.humanInLoop,
            individualImpact: init.flags.individualImpact,
            "data.retentionIntent": "Retained 7 years per clinical records policy.",
          },
          missing: [],
        };

  return {
    summary,
    intake,
    reviews: buildReviews(init),
    decisions: buildDecisions(init),
    controls: buildControls(init),
    telemetry: buildTelemetry(init),
    deployments: buildDeployments(init),
    events:
      init.slug === "member-chat-copilot"
        ? [...buildEvents(init), Q01_THRESHOLD_CHANGE_EVENT].sort(
            (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
          )
        : buildEvents(init),
  };
}

const SUMMARIES: InitiativeSummary[] = INITIATIVES.map(toSummary);
const DETAILS: Map<string, InitiativeDetail> = new Map(
  INITIATIVES.map((init) => [init.slug, toDetail(init)]),
);
// Workspace isolation foundation (M2.5 inc.2a) — every seeded fixture's
// workspaceId is undefined/absent, normalized to null here (all fixtures are
// "seeded/public", matching the DB provider's untagged seeded rows).
const WORKSPACE_BY_SLUG: Map<string, string | null> = new Map(
  INITIATIVES.map((init) => [init.slug, init.workspaceId ?? null]),
);

/**
 * Shared workspace-visibility check for the mock provider — mirrors
 * DbDataProvider's semantics (see lib/data/provider.ts's
 * WorkspaceScopedReadOptions doc): `opts` omitted -> visible to everyone.
 */
function isVisibleToViewer(slug: string, opts?: WorkspaceScopedReadOptions): boolean {
  if (!opts || !("viewerWorkspaceId" in opts)) return true;
  const rowWorkspaceId = WORKSPACE_BY_SLUG.get(slug) ?? null;
  const viewerWorkspaceId = opts.viewerWorkspaceId;
  if (viewerWorkspaceId === null || viewerWorkspaceId === undefined) {
    return rowWorkspaceId === null;
  }
  return rowWorkspaceId === null || rowWorkspaceId === viewerWorkspaceId;
}

// ---------------------------------------------------------------------------
// Outcome metrics (seed-spec §6) — computed constants, not seeded per-record,
// but chosen to match the spec's targets and remain internally consistent
// with the overdue/evidence-fresh initiatives above.
// ---------------------------------------------------------------------------

const OUTCOME_METRICS: OutcomeMetrics = {
  medianReviewCycleDays: 11,
  firstPassCompletenessPct: 60,
  // reviewerHoursSaved is expressed as a per-review estimate (~4h/review per
  // seed-spec §6's "drafted-vs-scratch estimate"), not an aggregate across
  // all reviews — the UI subtext "~4h/review" makes this explicit so the
  // single number 4 isn't misread as a portfolio-wide total.
  reviewerHoursSaved: 4,
  evidenceFresh: 10,
  evidenceTotal: 12,
  overdueControls: 3,
};

// ---------------------------------------------------------------------------
// Canned audit queries (seed-spec §7)
// ---------------------------------------------------------------------------

function memberFacingPhiQuery(): AuditQueryRow[] {
  const slugs = ["prior-auth-summarizer", "social-sentiment-miner", "member-chat-copilot", "formulary-qa-bot"];
  return slugs.map((slug) => {
    const init = INITIATIVES.find((i) => i.slug === slug)!;
    const detail = `approver=${init.accountableApprover ?? "none yet"}; controls=${buildControls(init).length} rows, ${
      buildControls(init).filter((c) => c.status === "met").length
    } met`;
    return {
      slug: init.slug,
      title: init.title,
      tier: init.tier,
      state: init.state,
      approver: init.accountableApprover,
      detail,
      eventTs: null,
    };
  });
}

function approvedByTorresQuery(): AuditQueryRow[] {
  return INITIATIVES.filter((init) => init.accountableApprover === ANGELA)
    .map((init) => {
      const decision = buildDecisions(init)[0];
      return {
        slug: init.slug,
        title: init.title,
        tier: init.tier,
        state: init.state,
        approver: ANGELA,
        detail: decision ? `${decision.type} on ${decision.at.slice(0, 10)}` : "approved",
        eventTs: decision?.at ?? null,
      };
    });
}

function overdueControlsQuery(): AuditQueryRow[] {
  const owners: Record<string, string> = {
    "formulary-qa-bot": "Sofia Grant — Responsible AI (missing bias-testing evidence)",
    "fwa-anomaly-detector": "Nia Okafor — Program Office (periodic review overdue)",
    "hr-resume-screener": "Program Office — bias-audit cadence exception pending",
  };
  return INITIATIVES.filter((init) => init.overdue).map((init) => ({
    slug: init.slug,
    title: init.title,
    tier: init.tier,
    state: init.state,
    approver: init.accountableApprover,
    detail: owners[init.slug] ?? "Remediation owner not assigned",
    eventTs: null,
  }));
}

function q01ControlChangesQuery(): AuditQueryRow[] {
  return [
    {
      slug: "member-chat-copilot",
      title: "Q-01 Eval quality floor — threshold change",
      tier: null,
      state: "control-change",
      approver: null,
      detail: Q01_THRESHOLD_CHANGE_EVENT.detail,
      eventTs: Q01_THRESHOLD_CHANGE_EVENT.ts,
    },
  ];
}

// ---------------------------------------------------------------------------
// DataProvider implementation
// ---------------------------------------------------------------------------

export class MockDataProvider implements DataProvider {
  async listInitiatives(opts?: WorkspaceScopedReadOptions): Promise<InitiativeSummary[]> {
    if (!opts || !("viewerWorkspaceId" in opts)) return SUMMARIES;
    return SUMMARIES.filter((s) => isVisibleToViewer(s.slug, opts));
  }

  async getInitiativeDetail(
    slug: string,
    opts?: WorkspaceScopedReadOptions,
  ): Promise<InitiativeDetail | null> {
    const detail = DETAILS.get(slug) ?? null;
    if (!detail) return null;
    if (!isVisibleToViewer(slug, opts)) return null;
    return detail;
  }

  async outcomeMetrics(): Promise<OutcomeMetrics> {
    return OUTCOME_METRICS;
  }

  async controlCatalog(): Promise<ControlRow[]> {
    // Deterministic evidenceAt fixture: index-based offset so a handful of
    // controls land past the 90-day staleness window (see
    // control-catalog.tsx#evidenceFreshness) without any randomness.
    const domainRows: ControlRow[] = CONTROL_CATALOG.map((entry, i) => ({
      id: entry.id,
      name: entry.name,
      domain: entry.domain,
      status: "met",
      policySource: entry.policySource,
      threshold: null,
      evidence: `${entry.name} evidence on file (catalog default)`,
      owner: entry.owner,
      cadence: entry.cadence,
      enforcementMode: entry.enforcementMode,
      remediationOwner: entry.remediationOwner,
      requiredEvidence: entry.requiredEvidence,
      // Alternate fresh/stale across the catalog: even index -> recent
      // (fresh), odd index -> 120 days old (stale).
      evidenceAt: isoAt(i % 2 === 0 ? -10 : -120),
      dueAt: isoAt(30 + i),
    }));

    const q01Row: ControlRow = {
      id: "Q-01",
      name: "Eval quality floor",
      domain: "runtime",
      status: "met",
      policySource: null,
      threshold: Q01_DEFAULT_THRESHOLD,
      evidence: "Global default threshold (High tier); Critical tier uses 0.05 per-initiative.",
      owner: RAY,
      cadence: "continuous",
      enforcementMode: "block",
      remediationOwner: RAY,
      requiredEvidence: "Eval observation stream (eval_hallucination) within threshold",
      evidenceAt: isoAt(-1),
      dueAt: null,
    };

    return [...domainRows, q01Row];
  }

  async auditQuery(id: CannedAuditQueryId): Promise<AuditQueryRow[]> {
    switch (id) {
      case "member-facing-phi":
        return memberFacingPhiQuery();
      case "approved-by-torres":
        return approvedByTorresQuery();
      case "overdue-controls":
        return overdueControlsQuery();
      case "q01-control-changes":
        return q01ControlChangesQuery();
    }
  }
}

// Re-exported for tests/ui fixtures that want typed access to the raw
// initiative list without going through the async provider interface.
export const MOCK_INITIATIVE_SLUGS = INITIATIVES.map((i) => i.slug);
