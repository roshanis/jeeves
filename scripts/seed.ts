// Deterministic seed script — docs/seed-spec.md is the authoritative
// dataset. Implements the "Meridian Health AI Portfolio" (9 actors, 12
// initiatives, 16+1 control catalog, telemetry series, ~120-150 audit
// events) with a fixed PRNG seed and fixed base date so two runs produce
// byte-identical row sets (seed-spec header; plan §8 test 5).
//
// NO Date.now() / wall-clock reads anywhere in this file — every timestamp
// is derived from BASE_DATE_MS via offsets.
import { deriveTier } from "../lib/triage/rules";
import { requiredDomains } from "../lib/triage/routing";
import type { Domain, OverlayFlags, Tier } from "../lib/domain/types";
import type { Db } from "../lib/db/client";
import {
  auditEvents,
  controlDefinitions,
  deploymentVersions,
  effectiveControls,
  incidents,
  initiativeDecisions,
  initiatives,
  intakeVersions,
  observations,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
  runBudget,
} from "../lib/db/schema";

/* -------------------------------------------------------------------------
 * Deterministic PRNG — mulberry32, keyed by a string seed.
 * ---------------------------------------------------------------------- */

export const SEED = "meridian-2026";
export const BASE_DATE_MS = Date.parse("2026-07-01T00:00:00Z");

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** mulberry32: fast, deterministic, good-enough-for-synthetic-data PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A named, independent, deterministic sub-stream of the global seed. */
function rngFor(...parts: string[]): () => number {
  return mulberry32(hashSeed(`${SEED}:${parts.join(":")}`));
}

const day = (n: number) => BASE_DATE_MS + n * 24 * 60 * 60 * 1000;
const dateAt = (n: number) => new Date(day(n));

/* -------------------------------------------------------------------------
 * §1 Actors
 * ---------------------------------------------------------------------- */

export const ACTORS = {
  priyaRaman: { name: "Priya Raman", role: "requester" as const },
  danKowalski: { name: "Dan Kowalski", role: "requester" as const },
  elenaVasquez: { name: "Dr. Elena Vasquez", role: "reviewer" as const },
  marcusWebb: { name: "Marcus Webb", role: "reviewer" as const },
  sofiaGrant: { name: "Sofia Grant", role: "reviewer" as const },
  jamesLiu: { name: "James Liu", role: "reviewer" as const },
  angelaTorres: { name: "Angela Torres", role: "approver" as const },
  rayChen: { name: "Ray Chen", role: "admin" as const },
  niaOkafor: { name: "Nia Okafor", role: "program" as const },
} as const;

/* -------------------------------------------------------------------------
 * §2 Initiatives — overlay flags in canonical order (PHI / member-facing /
 * care-coverage / vendor-hosted / human-in-the-loop / individual-impact).
 * ---------------------------------------------------------------------- */

interface InitiativeSeed {
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

export const INITIATIVE_SEEDS: InitiativeSeed[] = [
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

/** CRITICAL INVARIANT (task brief): deriveTier(flags) must agree with seed-spec's tier. */
function assertTierInvariant(seed: InitiativeSeed): Tier {
  const tier = deriveTier(seed.flags);
  if (tier !== seed.expectedTier) {
    throw new Error(
      `Tier invariant violated for ${seed.slug}: deriveTier() returned '${tier}' but seed-spec §2 expects '${seed.expectedTier}'`,
    );
  }
  return tier;
}

/* -------------------------------------------------------------------------
 * §3 Control catalog — 16 domain controls + Q-01 runtime control.
 * policySource strings follow docs/policies/INDEX.md's "Primary section(s)"
 * column exactly, per the INDEX's own guidance for constructing a literal
 * per-control citation string.
 * ---------------------------------------------------------------------- */

interface ControlSeed {
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

export const CONTROL_SEEDS: ControlSeed[] = [
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

/* -------------------------------------------------------------------------
 * Deterministic id helpers — stable, human-readable, collision-free within
 * a single seed run (idempotent re-seed always produces the same ids).
 * ---------------------------------------------------------------------- */

let idCounters: Record<string, number> = {};

function resetIdCounters() {
  idCounters = {};
}

function nextId(prefix: string): string {
  const n = (idCounters[prefix] ?? 0) + 1;
  idCounters[prefix] = n;
  return `${prefix}-${n}`;
}

/* -------------------------------------------------------------------------
 * Telemetry generation (seed-spec §4)
 * ---------------------------------------------------------------------- */

interface ObservationSeed {
  kind: string;
  ts: Date;
  value: number;
}

function clampNonNegative(v: number): number {
  return v < 0 ? 0 : v;
}

/** 30 daily points ending base+14d => days -15..+14. */
const SERIES_DAYS = Array.from({ length: 30 }, (_, i) => i - 15);

function memberChatCopilotSeries(): { hallucination: ObservationSeed[]; cost: ObservationSeed[] } {
  const rngHall = rngFor("member-chat-copilot", "eval_hallucination");
  const rngCost = rngFor("member-chat-copilot", "cost_tokens_usd_day");

  const hallucination: ObservationSeed[] = SERIES_DAYS.map((d) => {
    // seed-spec §4: 0.045 + 0.0035*day, where "day" counts from the base
    // date (§2 row 4: "crosses threshold 0.08 at base+9d"). History before
    // base stays flat around 0.045, so #4 is honestly DEPLOYED and healthy
    // at seed time; the ramp starts at base and the breach fires live when
    // the demo's monitor runs against the forward-seeded window. With
    // ±0.003 noise the value is strictly above 0.08 from day 11 onward
    // regardless of the draw (0.045 + 0.0035·11 − 0.003 = 0.0805), which
    // guarantees ≥3 consecutive breaching points (days 11–13) within
    // base+14d as the task brief requires; the first crossing lands at
    // day ~9–10.
    const base = 0.045 + 0.0035 * Math.max(0, d);
    const noise = (rngHall() - 0.5) * 0.006; // +/- 0.003, small vs. the ramp
    return { kind: "eval_hallucination", ts: dateAt(d), value: clampNonNegative(base + noise) };
  });

  const cost: ObservationSeed[] = SERIES_DAYS.map((d, i) => {
    const base = 80 + ((140 - 80) * i) / (SERIES_DAYS.length - 1);
    const noise = (rngCost() - 0.5) * 6;
    return { kind: "cost_tokens_usd_day", ts: dateAt(d), value: clampNonNegative(base + noise) };
  });

  return { hallucination, cost };
}

function flatHealthySeries(slug: string): ObservationSeed[] {
  const rng = rngFor(slug, "eval_hallucination");
  return SERIES_DAYS.map((d) => {
    const value = 0.03 + rng() * 0.02; // 0.03-0.05 band
    return { kind: "eval_hallucination", ts: dateAt(d), value };
  });
}

function gpuUtilSeries(slug: string): ObservationSeed[] {
  const rng = rngFor(slug, "gpu_util_pct");
  return SERIES_DAYS.map((d) => {
    const dow = ((d % 7) + 7) % 7; // 0..6
    const isWeekend = dow === 0 || dow === 6;
    const angle = (d / 7) * Math.PI * 2;
    const base = isWeekend ? 25 + Math.sin(angle) * 5 : 70 + Math.sin(angle) * 15;
    const noise = (rng() - 0.5) * 4;
    return { kind: "gpu_util_pct", ts: dateAt(d), value: clampNonNegative(base + noise) };
  });
}

function flatCostSeries(slug: string, low: number, high: number): ObservationSeed[] {
  const rng = rngFor(slug, "cost_tokens_usd_day");
  return SERIES_DAYS.map((d) => {
    const value = low + rng() * (high - low);
    return { kind: "cost_tokens_usd_day", ts: dateAt(d), value };
  });
}

/* -------------------------------------------------------------------------
 * Seed builder — one function per initiative that inserts every row
 * required to reach its seed-spec §2 state, generating the matching
 * AuditEvents so no state is orphaned (seed-spec §5).
 * ---------------------------------------------------------------------- */

interface SeedContext {
  db: Db;
  now: Date;
}

interface RowCounts {
  initiatives: number;
  intakeVersions: number;
  riskAssessments: number;
  reviewCycles: number;
  reviewDecisions: number;
  initiativeDecisions: number;
  deploymentVersions: number;
  controlDefinitions: number;
  effectiveControls: number;
  observations: number;
  incidents: number;
  auditEvents: number;
  runBudget: number;
}

async function insertAudit(
  ctx: SeedContext,
  row: {
    initiativeId: string | null;
    ts: Date;
    actor: string;
    actorRole: string;
    action: string;
    detail: string;
    before?: string | null;
    after?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.db.insert(auditEvents).values({
    id: nextId("audit"),
    initiativeId: row.initiativeId,
    ts: row.ts,
    actor: row.actor,
    actorRole: row.actorRole,
    action: row.action,
    detail: row.detail,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata,
  });
}

async function insertIntake(
  ctx: SeedContext,
  initiativeId: string,
  opts: {
    version: number;
    submitted: boolean;
    fields: Record<string, string | boolean | null>;
    missing: string[];
    createdAt: Date;
  },
) {
  const id = nextId("intake");
  await ctx.db.insert(intakeVersions).values({
    id,
    initiativeId,
    version: opts.version,
    submitted: opts.submitted,
    fields: opts.fields,
    missing: opts.missing,
    createdAt: opts.createdAt,
  });
  return id;
}

async function insertRiskAssessment(
  ctx: SeedContext,
  initiativeId: string,
  intakeVersionId: string,
  tier: Tier,
  seedFlags: OverlayFlags,
  createdAt: Date,
) {
  const id = nextId("risk");
  const domains = [...requiredDomains(tier, seedFlags)];
  await ctx.db.insert(riskAssessments).values({
    id,
    initiativeId,
    version: 1,
    intakeVersionId,
    tier,
    flags: seedFlags as unknown as Record<string, boolean>,
    requiredDomains: domains,
    createdAt,
  });
  return { id, domains };
}

/* -------------------------------------------------------------------------
 * Main seed function
 * ---------------------------------------------------------------------- */

export async function seedDatabase(db: Db): Promise<RowCounts> {
  resetIdCounters();
  const now = new Date(BASE_DATE_MS);
  const ctx: SeedContext = { db, now };

  // Wipe in FK-safe order (children before parents). audit_events is
  // append-only via trigger for UPDATE/DELETE from application code, but a
  // wipe-and-reinsert seed needs to clear prior rows too — DELETE is
  // rejected by the same trigger that protects audit_events in normal app
  // operation, so seeding truncates via a superuser-style raw statement
  // that temporarily disables the trigger for this one maintenance
  // operation, then re-enables it. This keeps the append-only guarantee
  // intact for the application role while still allowing deterministic
  // reseeds in dev/test.
  await db.execute(`ALTER TABLE audit_events DISABLE TRIGGER ALL;`);
  await db.delete(auditEvents);
  await db.execute(`ALTER TABLE audit_events ENABLE TRIGGER ALL;`);
  await db.delete(incidents);
  await db.delete(observations);
  await db.delete(effectiveControls);
  await db.delete(initiativeDecisions);
  await db.delete(reviewDecisions);
  await db.delete(reviewCycles);
  await db.delete(riskAssessments);
  await db.delete(intakeVersions);
  await db.delete(deploymentVersions);
  await db.delete(controlDefinitions);
  await db.delete(initiatives);
  await db.delete(runBudget);

  // --- Control catalog -----------------------------------------------
  for (const c of CONTROL_SEEDS) {
    await db.insert(controlDefinitions).values({
      id: c.id,
      domain: c.domain,
      name: c.name,
      applicability: c.applicability,
      policySource: c.policySource,
      owner: c.owner,
      requiredEvidence: c.requiredEvidence,
      cadence: c.cadence,
      enforcementMode: c.enforcementMode,
      exceptionProcess: c.exceptionProcess,
      remediationOwner: c.remediationOwner,
      observationKind: c.observationKind ?? null,
      tierDefaultThresholds: c.tierDefaultThresholds ?? null,
      sustainedWindow: c.sustainedWindow ?? null,
    });
  }

  // --- run_budget: one row for the seed base day ----------------------
  await db.insert(runBudget).values({
    id: nextId("budget"),
    day: "2026-07-01",
    tokensUsed: 0,
    tokensCap: 500000,
  });

  // Assert the tier invariant for every seeded initiative up front.
  const tiers = new Map<string, Tier>();
  for (const seed of INITIATIVE_SEEDS) {
    tiers.set(seed.slug, assertTierInvariant(seed));
  }

  const bySlug = new Map(INITIATIVE_SEEDS.map((s) => [s.slug, s]));
  const initiativeIds = new Map<string, string>();

  function seedOf(slug: string): InitiativeSeed {
    const s = bySlug.get(slug);
    if (!s) throw new Error(`unknown initiative slug: ${slug}`);
    return s;
  }
  function tierOf(slug: string): Tier {
    const t = tiers.get(slug);
    if (!t) throw new Error(`no tier computed for slug: ${slug}`);
    return t;
  }

  async function createInitiative(
    slug: string,
    state: string,
    opts: { accountableApprover?: string | null; createdAt: Date; updatedAt: Date },
  ) {
    const seed = seedOf(slug);
    const id = nextId("init");
    initiativeIds.set(slug, id);
    await db.insert(initiatives).values({
      id,
      slug: seed.slug,
      title: seed.title,
      requester: seed.requester,
      state,
      tier: tierOf(slug),
      accountableApprover: opts.accountableApprover ?? null,
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt,
    });
    return id;
  }

  /* ===================================================================
   * #1 prior-auth-summarizer — champion, UNSUBMITTED intake draft only.
   * data.retentionIntent is MISSING (not just blank) from `fields`.
   * =================================================================== */
  {
    const slug = "prior-auth-summarizer";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "intake_draft", {
      createdAt: dateAt(-2),
      updatedAt: dateAt(-2),
    });
    const fields: Record<string, string | boolean | null> = {
      "overlay.phi": seed.flags.phi,
      "overlay.memberFacing": seed.flags.memberFacing,
      "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
      "overlay.vendorHosted": seed.flags.vendorHosted,
      "overlay.humanInLoop": seed.flags.humanInLoop,
      "overlay.individualImpact": seed.flags.individualImpact,
      "data.sourceSystems": "Prior-auth queue export",
      // data.retentionIntent intentionally absent — champion completeness gap.
    };
    await insertIntake(ctx, initId, {
      version: 1,
      submitted: false,
      fields,
      missing: ["data.retentionIntent"],
      createdAt: dateAt(-2),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-2),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Prior-Auth Clinical Summarizer; data-retention answer not yet provided.",
    });
  }

  /* ===================================================================
   * #2 marketing-ab-tester — fast-lane approved, deployed.
   * =================================================================== */
  {
    const slug = "marketing-ab-tester";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-40),
      updatedAt: dateAt(-35),
    });
    const fields: Record<string, string | boolean | null> = {
      "overlay.phi": seed.flags.phi,
      "overlay.memberFacing": seed.flags.memberFacing,
      "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
      "overlay.vendorHosted": seed.flags.vendorHosted,
      "overlay.humanInLoop": seed.flags.humanInLoop,
      "overlay.individualImpact": seed.flags.individualImpact,
      "data.retentionIntent": "90-day retention, marketing analytics only",
    };
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields,
      missing: [],
      createdAt: dateAt(-40),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-41),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Marketing Copy A/B Tester.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-40),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Marketing Copy A/B Tester.",
    });

    const { id: raId } = await insertRiskAssessment(
      ctx,
      initId,
      intakeId,
      "low",
      seed.flags,
      dateAt(-39),
    );
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-39),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Low from overlay flags (PHI=N, member-facing=N, care-coverage=N).",
      metadata: { flags: seed.flags, tier: "low" },
    });

    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-38),
      closedAt: dateAt(-37),
    });

    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-38),
      actor: "system",
      actorRole: "system",
      action: "fast_lane_eligibility_computed",
      detail: "FL-2.1 eligibility computed: tier=Low, intake complete, no PHI/member-facing/care-coverage — eligible.",
      metadata: { policyId: "FL-2026-01", citations: ["FL-2.1"] },
    });

    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "fast_lane_approved",
      approver: ACTORS.angelaTorres.name,
      policyId: "FL-2026-01",
      citations: ["FL-2.1", "FL-3", "FL-3.1", "FL-3.2", "FL-4"],
      conditions: [],
      decidedAt: dateAt(-37),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-37),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "fast_lane_approve",
      detail: "Fast-lane approved under standing authority FL-2026-01 (FL-3.1); named accountable approver Angela Torres.",
      before: "triaged",
      after: "fast_lane_approved",
      metadata: { policyId: "FL-2026-01", citations: ["FL-2.1", "FL-3", "FL-3.1", "FL-3.2", "FL-4"] },
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.0",
      status: "deployed",
      modelVersion: "gpt-5.1-mini",
      selfHosted: false,
      deployedAt: dateAt(-35),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-35),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Marketing Copy A/B Tester v1.0.",
      before: "fast_lane_approved",
      after: "deployed",
    });

    // Required domains for #2 (low tier, vendor-hosted): data-governance,
    // legal, procurement, security. Fast-lane bypasses per-domain review
    // signatures, so effective controls are seeded straight to "met" or
    // "pending" evidence status without ReviewDecision rows.
    let v = 1;
    for (const c of ["D-01", "L-01", "L-02", "P-01", "P-02", "S-02"]) {
      await db.insert(effectiveControls).values({
        id: nextId("ec"),
        deploymentId: depId,
        controlId: c,
        version: v++,
        status: "met",
        evidence: `${c} evidence on file (fast-lane onboarding)`,
        evidenceAt: dateAt(-36),
        createdAt: dateAt(-36),
      });
    }

    // No telemetry for #2 — seed-spec §4 enumerates series only for
    // #4 (eval+cost), #5 (flat eval), #6 (gpu), #10 (cost) and #12 (flat eval).
  }

  /* ===================================================================
   * #3 social-sentiment-miner — rejected.
   * =================================================================== */
  {
    const slug = "social-sentiment-miner";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "rejected", {
      createdAt: dateAt(-30),
      updatedAt: dateAt(-20),
    });
    // First submission was incomplete (missing data-retention answer) —
    // contributes to the ~60% first-pass completeness metric (seed-spec §6).
    await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.sourceSystems": "Scraped member social-media mentions",
      },
      missing: ["data.retentionIntent"],
      createdAt: dateAt(-30),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 2,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Indefinite — public/social monitoring corpus",
        "data.sourceSystems": "Scraped member social-media mentions",
      },
      missing: [],
      createdAt: dateAt(-29),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-31),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Member Social-Media Sentiment Miner.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-30),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Member Social-Media Sentiment Miner.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-29),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_resubmitted",
      detail: "Resubmitted intake for Member Social-Media Sentiment Miner with the missing data-retention answer (v2).",
    });

    const { id: raId, domains } = await insertRiskAssessment(
      ctx,
      initId,
      intakeId,
      "high",
      seed.flags,
      dateAt(-29),
    );
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-29),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=High (PHI=Y).",
      metadata: { flags: seed.flags, tier: "high", requiredDomains: domains },
    });

    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-28),
      closedAt: dateAt(-20),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-28),
      actor: ACTORS.niaOkafor.name,
      actorRole: "program",
      action: "start_review",
      detail: "Opened initial review cycle across required domains.",
      before: "triaged",
      after: "in_review",
    });

    const rejectionDomains: { domain: Domain; reviewer: string; citations: string[]; detail: string }[] = [
      {
        domain: "privacy-hipaa",
        reviewer: ACTORS.marcusWebb.name,
        citations: ["MP-H-5.1(b)", "MP-H-5.2"],
        detail: "Rejected: unconsented inference from monitored member social-media communications; no documented consent basis for PHI-adjacent inference (MP-H-5.1(b)); recorded jointly with Responsible AI and Legal per MP-H-5.2.",
      },
      {
        domain: "responsible-ai",
        reviewer: ACTORS.sofiaGrant.name,
        citations: ["MP-R-5.1(a)", "MP-R-5.2"],
        detail: "Rejected: core function is unconsented inference of member sentiment/behavior from monitored communications (MP-R-5.1(a)); recorded jointly with Legal per MP-R-5.2.",
      },
      {
        domain: "legal",
        reviewer: ACTORS.jamesLiu.name,
        citations: ["MP-L-6.1(b)", "MP-L-6.2"],
        detail: "Rejected: inferring member sentiment/behavior from monitored public/social communications without a documented consent basis is presumptively inconsistent with MP-L-6.1(b); escalated per MP-L-6.2.",
      },
    ];

    for (const rd of rejectionDomains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: rd.domain,
        status: "signed",
        reviewer: rd.reviewer,
        draftMd: rd.detail,
        citations: rd.citations,
        signedAt: dateAt(-21),
        createdAt: dateAt(-25),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-21),
        actor: rd.reviewer,
        actorRole: "reviewer",
        action: "review_signed",
        detail: rd.detail,
        metadata: { domain: rd.domain, citations: rd.citations },
      });
    }

    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "rejected",
      approver: ACTORS.angelaTorres.name,
      citations: ["MP-H-5.1(b)", "MP-H-5.2", "MP-R-5.1(a)", "MP-R-5.2", "MP-L-6.1(b)", "MP-L-6.2"],
      conditions: [],
      decidedAt: dateAt(-20),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-20),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "reject",
      detail: "Rejected Member Social-Media Sentiment Miner: joint Privacy/HIPAA, Responsible AI, and Legal grounds for unconsented inference from monitored member communications.",
      before: "in_review",
      after: "rejected",
      metadata: { citations: ["MP-H-5.1(b)", "MP-H-5.2", "MP-R-5.1(a)", "MP-R-5.2", "MP-L-6.1(b)", "MP-L-6.2"] },
    });
  }

  /* ===================================================================
   * #4 member-chat-copilot — deployed v1.2; breach series crosses 0.08.
   * =================================================================== */
  {
    const slug = "member-chat-copilot";
    const seed = seedOf(slug);
    // Seed-spec §2 row 4: DEPLOYED at seed time. The breach -> pause ->
    // reassessment is the LIVE demo (plan §2 step 5) — the series below is
    // forward-seeded so the admin's "Run monitor" action fires it; no
    // incident/pause is pre-seeded.
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-60),
      updatedAt: dateAt(-45),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "30-day rolling window, chat transcripts",
      },
      missing: [],
      createdAt: dateAt(-60),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-61),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Member Services Chat Copilot.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-60),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Member Services Chat Copilot.",
    });

    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "high", seed.flags, dateAt(-59));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-59),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=High (PHI=Y).",
      metadata: { flags: seed.flags, tier: "high", requiredDomains: domains },
    });

    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-58),
      closedAt: dateAt(-50),
    });

    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "responsible-ai" ? ACTORS.sofiaGrant.name : d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for Member Services Chat Copilot.`,
        citations: [],
        signedAt: dateAt(-51),
        createdAt: dateAt(-55),
      });
    }
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-51),
      actor: ACTORS.niaOkafor.name,
      actorRole: "program",
      action: "all_domains_signed",
      detail: "All required domain reviews signed for Member Services Chat Copilot.",
    });

    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-50),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-50),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "approve",
      detail: "Approved Member Services Chat Copilot for deployment.",
      before: "in_review",
      after: "approved",
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.2",
      status: "deployed",
      modelVersion: "gpt-5.1",
      selfHosted: false,
      deployedAt: dateAt(-45),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-45),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Member Services Chat Copilot v1.2.",
      before: "approved",
      after: "deployed",
    });

    let v = 1;
    for (const c of ["D-01", "S-02", "T-01", "R-01", "R-02", "L-01", "H-01"]) {
      await db.insert(effectiveControls).values({
        id: nextId("ec"),
        deploymentId: depId,
        controlId: c,
        version: v++,
        status: "met",
        evidence: `${c} evidence on file`,
        evidenceAt: dateAt(-46),
        createdAt: dateAt(-46),
      });
    }
    // Q-01 effective control — green at seed time (values ~0.045 at base);
    // the threshold resolves from the tier default (high -> 0.08, already
    // tightened by Ray Chen's base-30d admin action below), so no
    // per-deployment override is recorded.
    await db.insert(effectiveControls).values({
      id: nextId("ec"),
      deploymentId: depId,
      controlId: "Q-01",
      version: v++,
      status: "met",
      evidence: "Monitor green at seed time; eval_hallucination ~0.045 at base date.",
      evidenceAt: dateAt(0),
      createdAt: dateAt(-45),
    });

    // Ray Chen's historical Q-01 tightening 0.10 -> 0.08 at base-30d
    // (foreshadows the breach — seed-spec §5).
    await insertAudit(ctx, {
      initiativeId: null,
      ts: dateAt(-30),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "control_threshold_changed",
      detail: "Tightened Q-01 eval-quality-floor threshold from 0.10 to 0.08 for the High tier.",
      before: "0.10",
      after: "0.08",
      metadata: { controlId: "Q-01", reason: "Q2 quality initiative" },
    });

    // Telemetry: breach series + cost ramp.
    const { hallucination, cost } = memberChatCopilotSeries();
    for (const o of [...hallucination, ...cost]) {
      await db.insert(observations).values({
        id: nextId("obs"),
        deploymentId: depId,
        kind: o.kind,
        ts: o.ts,
        value: o.value,
      });
    }

    // SEED INVARIANT (task brief / seed-spec §4): the forward-seeded series
    // MUST contain >=3 consecutive daily points strictly above 0.08 within
    // base+14d so the live monitor run has a guaranteed breach candidate.
    // The incident itself is NOT pre-seeded — the breach -> pause ->
    // reassessment sequence is the live demo (plan §2 step 5). This check
    // mirrors lib/controls/evaluate.ts's sustained-window rule.
    {
      const threshold = 0.08;
      const sustainedWindow = 3;
      const sorted = hallucination.slice().sort((a, b) => a.ts.getTime() - b.ts.getTime());
      let runLen = 0;
      let sustained = false;
      for (const point of sorted) {
        runLen = point.value > threshold ? runLen + 1 : 0;
        if (runLen >= sustainedWindow) {
          sustained = true;
          break;
        }
      }
      if (!sustained) {
        throw new Error(
          "Seed invariant violated: member-chat-copilot's eval_hallucination series does not contain a sustained breach (seed-spec §4 requires >=3 consecutive points strictly above 0.08 within base+14d).",
        );
      }
    }
  }

  /* ===================================================================
   * #5 pa-correspondence-model — deployed v2.0; v2.1 awaiting sign-off.
   * =================================================================== */
  {
    const slug = "pa-correspondence-model";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-90),
      updatedAt: dateAt(-5),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "7-year retention, correspondence archive",
      },
      missing: [],
      createdAt: dateAt(-90),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-91),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Prior-Auth Correspondence Drafting Model.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-90),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Prior-Auth Correspondence Drafting Model.",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "critical", seed.flags, dateAt(-89));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-89),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Critical (care-coverage=Y, human-in-loop=N).",
      metadata: { flags: seed.flags, tier: "critical", requiredDomains: domains },
    });

    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-88),
      closedAt: dateAt(-75),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-88),
      actor: ACTORS.niaOkafor.name,
      actorRole: "program",
      action: "start_review",
      detail: "Opened initial review cycle across required domains for Prior-Auth Correspondence Drafting Model.",
      before: "triaged",
      after: "in_review",
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "clinical-safety" ? ACTORS.elenaVasquez.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for Prior-Auth Correspondence Drafting Model.`,
        citations: [],
        signedAt: dateAt(-76),
        createdAt: dateAt(-80),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-80),
        actor: d === "clinical-safety" ? ACTORS.elenaVasquez.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_drafted",
        detail: `Drafted ${d} review for Prior-Auth Correspondence Drafting Model.`,
        metadata: { domain: d },
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-76),
        actor: d === "clinical-safety" ? ACTORS.elenaVasquez.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for Prior-Auth Correspondence Drafting Model.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-75),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-75),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "approve",
      detail: "Approved Prior-Auth Correspondence Drafting Model for deployment.",
      before: "in_review",
      after: "approved",
    });

    const depV1Id = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depV1Id,
      initiativeId: initId,
      version: "v2.0",
      status: "deployed",
      modelVersion: "meridian-correspondence-2.0",
      selfHosted: false,
      feedbackProvenanceSignedOff: true,
      deployedAt: dateAt(-70),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-70),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Prior-Auth Correspondence Drafting Model v2.0.",
      before: "approved",
      after: "deployed",
    });

    let v = 1;
    const v1Controls: string[] = [];
    if (domains.includes("clinical-safety")) v1Controls.push("C-01");
    if (domains.includes("legal")) v1Controls.push("L-01");
    for (const c of v1Controls) {
      await db.insert(effectiveControls).values({
        id: nextId("ec"),
        deploymentId: depV1Id,
        controlId: c,
        version: v++,
        status: "met",
        evidence: `${c} evidence on file`,
        evidenceAt: dateAt(-71),
        createdAt: dateAt(-71),
      });
    }

    for (const o of flatHealthySeries(slug)) {
      await db.insert(observations).values({
        id: nextId("obs"),
        deploymentId: depV1Id,
        kind: o.kind,
        ts: o.ts,
        value: o.value,
      });
    }

    // v2.1 checkpoint awaiting feedback-provenance sign-off (promotion gate).
    const depV2Id = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depV2Id,
      initiativeId: initId,
      version: "v2.1",
      status: "awaiting_promotion_signoff",
      modelVersion: "meridian-correspondence-2.1-checkpoint",
      selfHosted: false,
      feedbackProvenanceSignedOff: false,
      deployedAt: dateAt(-5),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-5),
      actor: ACTORS.priyaRaman.name,
      actorRole: "requester",
      action: "version_checkpoint_created",
      detail: "v2.1 checkpoint created from RL feedback data; awaiting feedback-provenance sign-off before promotion.",
      metadata: { version: "v2.1" },
    });
  }

  /* ===================================================================
   * #6 claims-ocr-coder — deployed, self-hosted, GPU panel.
   * =================================================================== */
  {
    const slug = "claims-ocr-coder";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-100),
      updatedAt: dateAt(-60),
    });
    // Incomplete first submission (missing retention answer) -> v2 resubmit.
    await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
      },
      missing: ["data.retentionIntent"],
      createdAt: dateAt(-100),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 2,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Claims retention schedule — 10 years",
      },
      missing: [],
      createdAt: dateAt(-99),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-101),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Claims Document OCR + Coding Model.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-100),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Claims Document OCR + Coding Model.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-99),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_resubmitted",
      detail: "Resubmitted intake for Claims Document OCR + Coding Model with the missing data-retention answer (v2).",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "high", seed.flags, dateAt(-99));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-99),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=High (care-coverage=Y, human-in-loop=Y).",
      metadata: { flags: seed.flags, tier: "high", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-98),
      closedAt: dateAt(-65),
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "clinical-safety" ? ACTORS.elenaVasquez.name : d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for Claims Document OCR + Coding Model.`,
        citations: [],
        signedAt: dateAt(-66),
        createdAt: dateAt(-70),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-66),
        actor: d === "clinical-safety" ? ACTORS.elenaVasquez.name : d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for Claims Document OCR + Coding Model.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-65),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-65),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "approve",
      detail: "Approved Claims Document OCR + Coding Model for deployment.",
      before: "in_review",
      after: "approved",
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.0",
      status: "deployed",
      modelVersion: "meridian-ocr-1.0-selfhosted",
      selfHosted: true,
      deployedAt: dateAt(-60),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-60),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Claims Document OCR + Coding Model v1.0 (self-hosted).",
      before: "approved",
      after: "deployed",
    });

    // seed-spec §4: #6 is the ONLY initiative with a gpu_util_pct series
    // (self-hosted workload); no eval series is assigned to it.
    for (const o of gpuUtilSeries(slug)) {
      await db.insert(observations).values({
        id: nextId("obs"),
        deploymentId: depId,
        kind: o.kind,
        ts: o.ts,
        value: o.value,
      });
    }
  }

  /* ===================================================================
   * #7 provider-dedup-agent — in review, exactly 3 of 5 domains signed.
   * =================================================================== */
  {
    const slug = "provider-dedup-agent";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "in_review", { createdAt: dateAt(-15), updatedAt: dateAt(-8) });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Provider directory records — indefinite while active",
      },
      missing: [],
      createdAt: dateAt(-15),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-16),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Provider Directory Dedup Agent.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-15),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Provider Directory Dedup Agent.",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "medium", seed.flags, dateAt(-14));
    if (domains.length !== 5) {
      throw new Error(
        `Seed invariant violated: provider-dedup-agent must require exactly 5 domains (seed-spec §2.1 sanity fixture), got ${domains.length}.`,
      );
    }
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-14),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Medium, 5 required domains (sanity fixture).",
      metadata: { flags: seed.flags, tier: "medium", requiredDomains: domains },
    });

    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-13),
    });
    const signed = domains.slice(0, 3);
    const pending = domains.slice(3);
    for (const d of signed) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for Provider Directory Dedup Agent.`,
        citations: [],
        signedAt: dateAt(-9),
        createdAt: dateAt(-12),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-9),
        actor: ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for Provider Directory Dedup Agent.`,
        metadata: { domain: d },
      });
    }
    for (const d of pending) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "pending",
        citations: [],
        createdAt: dateAt(-12),
      });
    }
  }

  /* ===================================================================
   * #8 nurse-triage-summarizer — conditionally approved, 2 conditions.
   * =================================================================== */
  {
    const slug = "nurse-triage-summarizer";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "conditionally_approved", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-25),
      updatedAt: dateAt(-10),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Call summaries — 3-year retention",
      },
      missing: [],
      createdAt: dateAt(-25),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-26),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Nurse Triage Line Summarizer.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-25),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Nurse Triage Line Summarizer.",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "critical", seed.flags, dateAt(-24));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-24),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Critical (care-coverage=Y, human-in-loop=N).",
      metadata: { flags: seed.flags, tier: "critical", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-22),
      closedAt: dateAt(-11),
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "clinical-safety" ? ACTORS.elenaVasquez.name : ACTORS.jamesLiu.name,
        draftMd:
          d === "clinical-safety"
            ? "Clinical Safety: clinician-in-the-loop checkpoint present; conditional approval preferred over rejection per MP-C-5.2."
            : `${d} review approved for Nurse Triage Line Summarizer.`,
        citations: d === "clinical-safety" ? ["MP-C-4.2", "MP-C-5.2"] : [],
        signedAt: dateAt(-12),
        createdAt: dateAt(-18),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-12),
        actor: d === "clinical-safety" ? ACTORS.elenaVasquez.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for Nurse Triage Line Summarizer.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "conditionally_approved",
      approver: ACTORS.angelaTorres.name,
      citations: ["MP-C-4.2", "MP-C-5.2"],
      conditions: [
        { text: "Human-review sampling rate of 100% for the first 90 days, stepping down per protocol.", controlId: "C-01" },
        { text: "Escalation-protocol refinement documented and signed off by Clinical Safety.", controlId: "C-02" },
      ],
      decidedAt: dateAt(-11),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-11),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "conditionally_approve",
      detail: "Conditionally approved Nurse Triage Line Summarizer with 2 open conditions linked to C-01/C-02 (MP-C-4.2, MP-C-5.2).",
      before: "in_review",
      after: "conditionally_approved",
      metadata: { citations: ["MP-C-4.2", "MP-C-5.2"], conditionCount: 2 },
    });

    // No deployment is seeded for #8: seed-spec §2 leaves it at
    // "Conditionally approved — 2 open conditions"; the conditions live on
    // the initiative decision (linked to C-01/C-02 by controlId) and
    // seed-spec §4 assigns it no telemetry.
  }

  /* ===================================================================
   * #9 formulary-qa-bot — RAI review returned by Sofia Grant.
   * =================================================================== */
  {
    const slug = "formulary-qa-bot";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "in_review", { createdAt: dateAt(-18), updatedAt: dateAt(-6) });
    // Incomplete first submission (missing retention answer) -> v2 resubmit.
    await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
      },
      missing: ["data.retentionIntent"],
      createdAt: dateAt(-18),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 2,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Formulary Q&A transcripts — 1-year retention",
      },
      missing: [],
      createdAt: dateAt(-17),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-19),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Member Formulary Q&A Bot.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-18),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Member Formulary Q&A Bot.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-17),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_resubmitted",
      detail: "Resubmitted intake for Member Formulary Q&A Bot with the missing data-retention answer (v2).",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "high", seed.flags, dateAt(-17));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-17),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=High (PHI=Y).",
      metadata: { flags: seed.flags, tier: "high", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-16),
    });
    for (const d of domains) {
      if (d === "responsible-ai") {
        await db.insert(reviewDecisions).values({
          id: nextId("rd"),
          cycleId,
          domain: d,
          status: "returned",
          reviewer: ACTORS.sofiaGrant.name,
          draftMd: "Returned: bias-testing evidence for member-facing formulary Q&A is missing subgroup breakdown required by MP-R-2.2.",
          citations: ["MP-R-2.4", "MP-R-7"],
          returnReason: "Missing bias-testing evidence (subgroup breakdown) per MP-R-2.2.",
          createdAt: dateAt(-7),
        });
        await insertAudit(ctx, {
          initiativeId: initId,
          ts: dateAt(-6),
          actor: ACTORS.sofiaGrant.name,
          actorRole: "reviewer",
          action: "review_returned",
          detail: "Sofia Grant returned the Responsible AI review for Member Formulary Q&A Bot: missing bias-testing evidence (MP-R-2.4, MP-R-7).",
          metadata: { domain: d, citations: ["MP-R-2.4", "MP-R-7"] },
        });
      } else {
        await db.insert(reviewDecisions).values({
          id: nextId("rd"),
          cycleId,
          domain: d,
          status: "signed",
          reviewer: d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
          draftMd: `${d} review approved for Member Formulary Q&A Bot.`,
          citations: [],
          signedAt: dateAt(-9),
          createdAt: dateAt(-14),
        });
        await insertAudit(ctx, {
          initiativeId: initId,
          ts: dateAt(-9),
          actor: d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
          actorRole: "reviewer",
          action: "review_signed",
          detail: `Signed ${d} review for Member Formulary Q&A Bot.`,
          metadata: { domain: d },
        });
      }
    }
  }

  /* ===================================================================
   * #10 fwa-anomaly-detector — operating 14 months, periodic review overdue.
   * =================================================================== */
  {
    const slug = "fwa-anomaly-detector";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-450),
      updatedAt: dateAt(-420),
    });
    // Incomplete first submission (missing retention answer) -> v2 resubmit.
    await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
      },
      missing: ["data.retentionIntent"],
      createdAt: dateAt(-450),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 2,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "FWA case records — 7-year retention",
      },
      missing: [],
      createdAt: dateAt(-449),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-451),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Fraud, Waste & Abuse Anomaly Detector.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-450),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Fraud, Waste & Abuse Anomaly Detector.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-449),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_resubmitted",
      detail: "Resubmitted intake for Fraud, Waste & Abuse Anomaly Detector with the missing data-retention answer (v2).",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "high", seed.flags, dateAt(-449));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-449),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=High (care-coverage=Y, human-in-loop=Y).",
      metadata: { flags: seed.flags, tier: "high", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-448),
      closedAt: dateAt(-425),
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "clinical-safety" ? ACTORS.elenaVasquez.name : d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for FWA Anomaly Detector.`,
        citations: [],
        signedAt: dateAt(-426),
        createdAt: dateAt(-430),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-426),
        actor: d === "clinical-safety" ? ACTORS.elenaVasquez.name : d === "privacy-hipaa" ? ACTORS.marcusWebb.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for FWA Anomaly Detector.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-425),
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.0",
      status: "deployed",
      modelVersion: "meridian-fwa-1.0",
      selfHosted: false,
      deployedAt: dateAt(-420),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-420),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Fraud, Waste & Abuse Anomaly Detector v1.0.",
      before: "approved",
      after: "deployed",
    });

    // Overdue periodic review: D-02 retention schedule (annual) last
    // refreshed at base-420d, due at base-55d, still not refreshed —
    // MP-D-3.2 / MP-D-7.2.
    await db.insert(effectiveControls).values({
      id: nextId("ec"),
      deploymentId: depId,
      controlId: "D-02",
      version: 1,
      status: "overdue",
      evidence: "Retention & disposal schedule last refreshed base-420d; annual cadence lapsed.",
      evidenceAt: dateAt(-420),
      dueAt: dateAt(-55),
      remediationOwner: ACTORS.niaOkafor.name,
      createdAt: dateAt(-420),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-55),
      actor: "system",
      actorRole: "system",
      action: "control_overdue",
      detail: "D-02 retention & disposal schedule became overdue (annual cadence, MP-D-3.2 / MP-D-7.2).",
      metadata: { controlId: "D-02", citations: ["MP-D-3.2", "MP-D-7.2"] },
    });

    for (const o of flatCostSeries(slug, 20, 40)) {
      await db.insert(observations).values({
        id: nextId("obs"),
        deploymentId: depId,
        kind: o.kind,
        ts: o.ts,
        value: o.value,
      });
    }
  }

  /* ===================================================================
   * #11 hr-resume-screener — approved, exception_requested on R-01.
   * =================================================================== */
  {
    const slug = "hr-resume-screener";
    const seed = seedOf(slug);
    // Seed-spec §2 row 11 says "Approved with an exception request pending";
    // it is seeded as 'deployed' because §6 counts its evidence as stale
    // (operating) and the R-01 exception attaches to a per-deployment
    // effective control — the approval itself is preserved as the
    // initiative decision + audit trail. Judgment call, noted in the
    // implementation report.
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-200),
      updatedAt: dateAt(-180),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "Candidate records — per HR retention policy",
      },
      missing: [],
      createdAt: dateAt(-200),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-201),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for HR Résumé Screener.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-200),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for HR Résumé Screener.",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "medium", seed.flags, dateAt(-199));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-199),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Medium (vendor-hosted, individual-impact).",
      metadata: { flags: seed.flags, tier: "medium", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-198),
      closedAt: dateAt(-185),
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "responsible-ai" ? ACTORS.sofiaGrant.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for HR Résumé Screener.`,
        citations: [],
        signedAt: dateAt(-186),
        createdAt: dateAt(-190),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-186),
        actor: d === "responsible-ai" ? ACTORS.sofiaGrant.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for HR Résumé Screener.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-185),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-185),
      actor: ACTORS.angelaTorres.name,
      actorRole: "approver",
      action: "approve",
      detail: "Approved HR Résumé Screener.",
      before: "in_review",
      after: "approved",
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.0",
      status: "deployed",
      modelVersion: "vendor-hr-screener-1.0",
      selfHosted: false,
      deployedAt: dateAt(-180),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-180),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed HR Résumé Screener v1.0.",
      before: "approved",
      after: "deployed",
    });

    await db.insert(effectiveControls).values({
      id: nextId("ec"),
      deploymentId: depId,
      controlId: "R-01",
      version: 1,
      status: "exception_requested",
      evidence: "Exception requested to waive the semi-annual bias-audit cadence (MP-R-2.3) for this cycle.",
      remediationOwner: ACTORS.sofiaGrant.name,
      createdAt: dateAt(-30),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-30),
      actor: ACTORS.niaOkafor.name,
      actorRole: "program",
      action: "exception_requested",
      detail: "Requested an exception to the R-01 semi-annual bias-audit cadence (MP-R-2.3) pending Program Office review.",
      metadata: { controlId: "R-01", citations: ["MP-R-2.3"] },
    });
    // No telemetry for #11 — not in seed-spec §4's series enumeration.
  }

  /* ===================================================================
   * #12 callcenter-qa-scorer — operating, healthy, all controls green.
   * =================================================================== */
  {
    const slug = "callcenter-qa-scorer";
    const seed = seedOf(slug);
    const initId = await createInitiative(slug, "deployed", {
      accountableApprover: ACTORS.angelaTorres.name,
      createdAt: dateAt(-150),
      updatedAt: dateAt(-140),
    });
    const intakeId = await insertIntake(ctx, initId, {
      version: 1,
      submitted: true,
      fields: {
        "overlay.phi": seed.flags.phi,
        "overlay.memberFacing": seed.flags.memberFacing,
        "overlay.careCoverageInfluence": seed.flags.careCoverageInfluence,
        "overlay.vendorHosted": seed.flags.vendorHosted,
        "overlay.humanInLoop": seed.flags.humanInLoop,
        "overlay.individualImpact": seed.flags.individualImpact,
        "data.retentionIntent": "QA scoring transcripts — 1-year retention",
      },
      missing: [],
      createdAt: dateAt(-150),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-151),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_drafted",
      detail: "Started intake draft for Call Center QA Auto-Scorer.",
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-150),
      actor: seed.requester,
      actorRole: "requester",
      action: "intake_submitted",
      detail: "Submitted intake for Call Center QA Auto-Scorer.",
    });
    const { id: raId, domains } = await insertRiskAssessment(ctx, initId, intakeId, "medium", seed.flags, dateAt(-149));
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-149),
      actor: "system",
      actorRole: "system",
      action: "triage_classified",
      detail: "Deterministic triage classified tier=Medium (individual-impact).",
      metadata: { flags: seed.flags, tier: "medium", requiredDomains: domains },
    });
    const cycleId = nextId("cycle");
    await db.insert(reviewCycles).values({
      id: cycleId,
      initiativeId: initId,
      kind: "initial",
      riskAssessmentId: raId,
      openedAt: dateAt(-148),
      closedAt: dateAt(-141),
    });
    for (const d of domains) {
      await db.insert(reviewDecisions).values({
        id: nextId("rd"),
        cycleId,
        domain: d,
        status: "signed",
        reviewer: d === "responsible-ai" ? ACTORS.sofiaGrant.name : ACTORS.jamesLiu.name,
        draftMd: `${d} review approved for Call Center QA Auto-Scorer.`,
        citations: [],
        signedAt: dateAt(-142),
        createdAt: dateAt(-145),
      });
      await insertAudit(ctx, {
        initiativeId: initId,
        ts: dateAt(-142),
        actor: d === "responsible-ai" ? ACTORS.sofiaGrant.name : ACTORS.jamesLiu.name,
        actorRole: "reviewer",
        action: "review_signed",
        detail: `Signed ${d} review for Call Center QA Auto-Scorer.`,
        metadata: { domain: d },
      });
    }
    await db.insert(initiativeDecisions).values({
      id: nextId("decision"),
      initiativeId: initId,
      cycleId,
      type: "approved",
      approver: ACTORS.angelaTorres.name,
      citations: [],
      conditions: [],
      decidedAt: dateAt(-141),
    });

    const depId = nextId("dep");
    await db.insert(deploymentVersions).values({
      id: depId,
      initiativeId: initId,
      version: "v1.0",
      status: "deployed",
      modelVersion: "meridian-callcenter-qa-1.0",
      selfHosted: false,
      deployedAt: dateAt(-140),
    });
    await insertAudit(ctx, {
      initiativeId: initId,
      ts: dateAt(-140),
      actor: ACTORS.rayChen.name,
      actorRole: "admin",
      action: "deploy",
      detail: "Deployed Call Center QA Auto-Scorer v1.0.",
      before: "approved",
      after: "deployed",
    });

    let v = 1;
    for (const c of ["D-01", "S-02", "T-01", "R-02", "L-01"]) {
      await db.insert(effectiveControls).values({
        id: nextId("ec"),
        deploymentId: depId,
        controlId: c,
        version: v++,
        status: "met",
        evidence: `${c} evidence on file — healthy baseline.`,
        evidenceAt: dateAt(-139),
        createdAt: dateAt(-139),
      });
    }

    for (const o of flatHealthySeries(slug)) {
      await db.insert(observations).values({
        id: nextId("obs"),
        deploymentId: depId,
        kind: o.kind,
        ts: o.ts,
        value: o.value,
      });
    }
  }

  const counts: RowCounts = {
    initiatives: INITIATIVE_SEEDS.length,
    intakeVersions: idCounters["intake"] ?? 0,
    riskAssessments: idCounters["risk"] ?? 0,
    reviewCycles: idCounters["cycle"] ?? 0,
    reviewDecisions: idCounters["rd"] ?? 0,
    initiativeDecisions: idCounters["decision"] ?? 0,
    deploymentVersions: idCounters["dep"] ?? 0,
    controlDefinitions: CONTROL_SEEDS.length,
    effectiveControls: idCounters["ec"] ?? 0,
    observations: idCounters["obs"] ?? 0,
    incidents: idCounters["incident"] ?? 0,
    auditEvents: idCounters["audit"] ?? 0,
    runBudget: idCounters["budget"] ?? 0,
  };

  return counts;
}

/* -------------------------------------------------------------------------
 * CLI entry point — `npm run db:seed`
 * ---------------------------------------------------------------------- */
async function main() {
  const { getDb, closeDb } = await import("../lib/db/client");
  const db = getDb();

  // Ensure the schema exists before seeding. Against the local PGlite dev
  // store (no DATABASE_URL) the real migrations under drizzle/ are applied
  // here; against Neon the same migrations run via the neon-http migrator.
  // Both migrators are idempotent (drizzle's migrations journal table).
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    type NeonDb = Parameters<typeof migrate>[0];
    await migrate(db as NeonDb, { migrationsFolder: "./drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    type PgliteDb = Parameters<typeof migrate>[0];
    await migrate(db as PgliteDb, { migrationsFolder: "./drizzle" });
  }

  const counts = await seedDatabase(db);
   
  console.log("Seed complete:", JSON.stringify(counts, null, 2));

  // Release the PGlite handle so the CLI process exits promptly.
  await closeDb();
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  // Production guard: this CLI wipes and repopulates every seeded table
  // (see the DISABLE/ENABLE TRIGGER dance in seedDatabase above), so it
  // must never fire against a real deployment by accident. Refuse to run
  // when NODE_ENV=production unless the operator explicitly opts in via
  // ALLOW_SEED=1 (e.g. a one-off, deliberate reseed of a hosted demo env).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "1") {
    console.error(
      "Refusing to run scripts/seed.ts: NODE_ENV=production and ALLOW_SEED is not set to \"1\". " +
        "This script destructively wipes and repopulates the database. " +
        "Set ALLOW_SEED=1 to explicitly confirm a production reseed.",
    );
    process.exitCode = 1;
  } else {
    main().catch((err) => {

      console.error(err);
      process.exit(1);
    });
  }
}
