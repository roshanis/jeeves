/**
 * Intake completeness engine (intake-spec §2).
 *
 * Pure evaluation of an `IntakePayload` against the three-level rules
 * table: BLOCKING (always evaluated, gates submit), REQUIRED-FOR-TIER
 * (evaluated once a tier is known — fired against overlay-flag/tier trigger
 * conditions, does not block initial submit), and ADVISORY (warnings only,
 * never block anything).
 *
 * `evaluateCompleteness` never reads the wall clock, never mutates its
 * input, and has no I/O — same style as `lib/triage/rules.ts` and
 * `lib/controls/evaluate.ts`.
 */

import type { Tier } from "../domain/types";
import type { IntakePayload } from "./types";

/** The three completeness levels from intake-spec §2. */
export type CompletenessLevel = "BLOCKING" | "REQUIRED_FOR_TIER" | "ADVISORY";

/** A single failing rule, surfaced to the requester/reviewer. */
export interface CompletenessGap {
  ruleId: string;
  level: CompletenessLevel;
  field: string;
  message: string;
}

export interface CompletenessResult {
  /** True iff all BLOCKING rules pass (intake-spec §2 Level 1 gates submit). */
  canSubmit: boolean;
  gaps: CompletenessGap[];
  /**
   * Percentage (0-100) of all *evaluated* rules (BLOCKING + applicable
   * REQUIRED-FOR-TIER + ADVISORY) that pass. 100 means zero gaps of any
   * level.
   */
  completenessPct: number;
}

// ---------------------------------------------------------------------------
// Small field-level helpers
// ---------------------------------------------------------------------------

function isNonEmptyStringInRange(value: string | null | undefined, min: number, max: number): boolean {
  if (typeof value !== "string") return false;
  const len = value.length;
  return len >= min && len <= max;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && EMAIL_RE.test(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonEmptyArrayOfStrings(
  value: string[] | null | undefined,
  entryMin: number,
  entryMax: number,
): boolean {
  if (!Array.isArray(value) || value.length < 1) return false;
  return value.every((entry) => isNonEmptyStringInRange(entry, entryMin, entryMax));
}

// ---------------------------------------------------------------------------
// Level 1 — BLOCKING (intake-spec §2 table)
// ---------------------------------------------------------------------------

interface RuleCheck {
  ruleId: string;
  field: string;
  message: string;
  passes: (payload: IntakePayload) => boolean;
}

const BLOCKING_RULES: RuleCheck[] = [
  {
    ruleId: "BLK-01",
    field: "basics.title",
    message: "Initiative title is required (3-120 characters).",
    passes: (p) => isNonEmptyStringInRange(p.basics.title, 3, 120),
  },
  {
    ruleId: "BLK-02",
    field: "basics.sponsorOrg",
    message: "Sponsor organization is required (2-120 characters).",
    passes: (p) => isNonEmptyStringInRange(p.basics.sponsorOrg, 2, 120),
  },
  {
    ruleId: "BLK-03",
    field: "basics.requesterName,basics.requesterEmail",
    message: "Requester name and a valid requester email are required.",
    passes: (p) =>
      isNonEmptyStringInRange(p.basics.requesterName, 2, 120) && isValidEmail(p.basics.requesterEmail),
  },
  {
    ruleId: "BLK-04",
    field: "basics.businessProblem",
    message: "Business problem description is required (at least 20 characters).",
    passes: (p) => isNonEmptyStringInRange(p.basics.businessProblem, 20, 2000),
  },
  {
    ruleId: "BLK-05",
    field: "overlay.touchesPHI",
    message: "Please answer: does it access PHI?",
    passes: (p) => isBoolean(p.overlay.touchesPHI),
  },
  {
    ruleId: "BLK-06",
    field: "overlay.memberFacing",
    message: "Please answer: do members interact with or receive its output directly?",
    passes: (p) => isBoolean(p.overlay.memberFacing),
  },
  {
    ruleId: "BLK-07",
    field: "overlay.careCoverageInfluence",
    message: "Please answer: does it influence care or coverage decisions?",
    passes: (p) => isBoolean(p.overlay.careCoverageInfluence),
  },
  {
    ruleId: "BLK-08",
    field: "overlay.vendorHosted",
    message: "Please answer: is the model vendor-hosted?",
    passes: (p) => isBoolean(p.overlay.vendorHosted),
  },
  {
    ruleId: "BLK-09",
    field: "overlay.humanInTheLoop",
    message: "Please answer: does a qualified human review each output before it takes effect?",
    passes: (p) => isBoolean(p.overlay.humanInTheLoop),
  },
  {
    ruleId: "BLK-10",
    field: "overlay.individualImpact",
    message:
      "Please answer: does it affect individuals' opportunities, rights, or services?",
    passes: (p) => isBoolean(p.overlay.individualImpact),
  },
  {
    ruleId: "BLK-11",
    field: "data.dataSources",
    message: "At least one data source is required (each 2-200 characters).",
    passes: (p) => isNonEmptyArrayOfStrings(p.data.dataSources, 2, 200),
  },
];

// ---------------------------------------------------------------------------
// Level 2 — REQUIRED-FOR-TIER (intake-spec §2 table)
// ---------------------------------------------------------------------------

interface TieredRuleCheck {
  ruleId: string;
  field: string;
  message: string;
  /** Whether this rule's trigger condition holds for the given payload/tier. */
  triggers: (payload: IntakePayload, tier: Tier | undefined) => boolean;
  passes: (payload: IntakePayload, tier: Tier | undefined) => boolean;
}

function isVendorInvolved(payload: IntakePayload): boolean {
  return (
    payload.overlay.vendorHosted === true ||
    payload.modelVendor.buildOrBuy === "Buy (vendor)" ||
    payload.modelVendor.buildOrBuy === "Hybrid"
  );
}

const REQUIRED_FOR_TIER_RULES: TieredRuleCheck[] = [
  {
    ruleId: "RFT-01",
    field: "data.phiCategories",
    message: "PHI categories touched are required for PHI-touching initiatives.",
    triggers: (p) => p.overlay.touchesPHI === true,
    passes: (p) => Array.isArray(p.data.phiCategories) && p.data.phiCategories.length >= 1,
  },
  {
    ruleId: "RFT-02",
    field: "data.retentionIntent",
    message:
      "PHI data retention intent is required for PHI-touching initiatives — please specify how long this data will be retained.",
    triggers: (p) => p.overlay.touchesPHI === true,
    passes: (p) => p.data.retentionIntent !== null && p.data.retentionIntent !== undefined,
  },
  {
    ruleId: "RFT-03",
    field: "modelVendor.vendorName",
    message: "Vendor name is required when the model is vendor-hosted or bought/hybrid.",
    triggers: (p) =>
      p.overlay.vendorHosted === true ||
      p.modelVendor.buildOrBuy === "Buy (vendor)" ||
      p.modelVendor.buildOrBuy === "Hybrid",
    passes: (p) => isNonEmptyStringInRange(p.modelVendor.vendorName, 2, 120),
  },
  {
    ruleId: "RFT-04",
    field: "modelVendor.hosting",
    message: "Hosting must be set to Vendor-hosted when overlay.vendorHosted is true.",
    triggers: (p) => p.overlay.vendorHosted === true,
    passes: (p) => p.modelVendor.hosting === "Vendor-hosted",
  },
  {
    ruleId: "RFT-05",
    field: "modelVendor.hosting",
    message: "Hosting must be set to Self-hosted (Meridian infra) when overlay.vendorHosted is false.",
    triggers: (p) => p.overlay.vendorHosted === false,
    passes: (p) => p.modelVendor.hosting === "Self-hosted (Meridian infra)",
  },
  {
    ruleId: "RFT-06",
    field: "useCase.decisionInformed",
    message:
      "Care/coverage-influencing initiatives must clearly name the concrete decision informed (at least 10 characters).",
    triggers: (p) => p.overlay.careCoverageInfluence === true,
    passes: (p) => isNonEmptyStringInRange(p.useCase.decisionInformed, 10, 300),
  },
  {
    ruleId: "RFT-07",
    field: "populationImpact.expectedHarms",
    message:
      "Expected harms/risks are required for High/Critical-tier initiatives and must be distinct from expected benefits.",
    triggers: (_p, tier) => tier === "high" || tier === "critical",
    passes: (p) =>
      isNonEmptyStringInRange(p.populationImpact.expectedHarms, 10, 1000) &&
      p.populationImpact.expectedHarms !== p.populationImpact.expectedBenefits,
  },
  {
    ruleId: "RFT-08",
    field: "data.dataSources",
    message:
      "Training/fine-tuning use requires at least one data source that is not ephemeral/session-only.",
    triggers: (p) =>
      p.data.trainingVsInference === "Fine-tuning/training" || p.data.trainingVsInference === "Both",
    passes: (p) => {
      // Cross-check against retentionIntent when PHI=Y: session-only retention
      // means the data cannot be used for training/fine-tuning.
      if (p.overlay.touchesPHI === true && p.data.retentionIntent === "Session-only (no persistence)") {
        return false;
      }
      return true;
    },
  },
];

// ---------------------------------------------------------------------------
// Level 3 — ADVISORY (intake-spec §2 table)
// ---------------------------------------------------------------------------

/**
 * §1h "Sometimes" (evidence-eligible) controls and the overlay/tier
 * condition under which each applies, per seed-spec §2.1's control catalog:
 *   L-01 / P-01 / P-02 : vendor=Y
 *   R-01                : member-facing=Y or care-coverage=Y
 *   R-02 / D-01         : all >= Medium tier
 *   S-01                : tier >= High
 *   H-01                : PHI=Y
 */
function hasEvidenceEligibleControl(payload: IntakePayload, tier: Tier | undefined): boolean {
  const vendorInvolved = isVendorInvolved(payload);
  if (vendorInvolved) return true; // L-01, P-01, P-02
  if (payload.overlay.memberFacing === true || payload.overlay.careCoverageInfluence === true) return true; // R-01
  if (payload.overlay.touchesPHI === true) return true; // H-01
  // tier >= Medium covers R-02/D-01; S-01 (tier >= High) is a strict subset
  // of that condition, so no separate check is needed.
  if (tier === "medium" || tier === "high" || tier === "critical") return true; // R-02, D-01, S-01
  return false;
}

interface AdvisoryRuleCheck {
  ruleId: string;
  field: string;
  message: string;
  /** Whether this advisory rule applies at all (defaults to always true). */
  applies: (payload: IntakePayload, tier: Tier | undefined) => boolean;
  passes: (payload: IntakePayload, tier: Tier | undefined) => boolean;
}

const ADVISORY_RULES: AdvisoryRuleCheck[] = [
  {
    ruleId: "ADV-01",
    field: "useCase.expectedVolume",
    message: "Expected volume not estimated — helps size review urgency.",
    applies: () => true,
    passes: (p) => p.useCase.expectedVolume !== null && p.useCase.expectedVolume !== undefined,
  },
  {
    ruleId: "ADV-02",
    field: "populationImpact.affectedPopulations",
    message: "No affected population named — add at least one (members/providers/employees).",
    applies: () => true,
    passes: (p) => Array.isArray(p.populationImpact.affectedPopulations) && p.populationImpact.affectedPopulations.length >= 1,
  },
  {
    ruleId: "ADV-03",
    field: "deployment.integrationPoints",
    message: "No integration point named — reviewers need to know where output lands.",
    applies: () => true,
    passes: (p) => Array.isArray(p.deployment.integrationPoints) && p.deployment.integrationPoints.length >= 1,
  },
  {
    ruleId: "ADV-04",
    field: "deployment.rolloutPlan",
    message: "Rollout plan not described — add pilot scope or phased plan.",
    applies: () => true,
    passes: (p) => isNonEmptyStringInRange(p.deployment.rolloutPlan, 10, 1000),
  },
  {
    ruleId: "ADV-05",
    field: "evidenceAttachments",
    message:
      "No evidence pre-attached — attaching existing artifacts (vendor addendum, model card, etc.) speeds up review.",
    applies: (p, tier) => hasEvidenceEligibleControl(p, tier),
    passes: (p) => Array.isArray(p.evidenceAttachments) && p.evidenceAttachments.length >= 1,
  },
  {
    ruleId: "ADV-06",
    field: "modelVendor.modelType",
    message: "Model type not specified — helps route to the right technical reviewer.",
    applies: () => true,
    passes: (p) => p.modelVendor.modelType !== null && p.modelVendor.modelType !== undefined,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the full intake-spec §2 completeness model against a payload.
 *
 * `tier` is optional: pass it once `lib/triage/rules.ts`'s `deriveTier` has
 * run against the payload's overlay flags. Until then, REQUIRED-FOR-TIER
 * rules keyed off a derived tier (currently only `RFT-07`) are skipped —
 * they simply don't trigger pre-triage, matching intake-spec §2 Level 2's
 * "computed after triage runs" scoping. Rules keyed off raw overlay flags
 * (RFT-01..06, RFT-08) evaluate regardless of whether `tier` is supplied.
 *
 * `canSubmit` reflects Level 1 (BLOCKING) only — per intake-spec §2 Level 2
 * preamble, REQUIRED-FOR-TIER gaps do not block the initial submit action,
 * and ADVISORY gaps never block anything.
 */
export function evaluateCompleteness(payload: IntakePayload, tier?: Tier): CompletenessResult {
  const gaps: CompletenessGap[] = [];

  let blockingEvaluated = 0;
  let blockingPassed = 0;
  for (const rule of BLOCKING_RULES) {
    blockingEvaluated += 1;
    const ok = rule.passes(payload);
    if (ok) {
      blockingPassed += 1;
    } else {
      gaps.push({ ruleId: rule.ruleId, level: "BLOCKING", field: rule.field, message: rule.message });
    }
  }

  let rftEvaluated = 0;
  let rftPassed = 0;
  for (const rule of REQUIRED_FOR_TIER_RULES) {
    if (!rule.triggers(payload, tier)) continue;
    rftEvaluated += 1;
    const ok = rule.passes(payload, tier);
    if (ok) {
      rftPassed += 1;
    } else {
      gaps.push({ ruleId: rule.ruleId, level: "REQUIRED_FOR_TIER", field: rule.field, message: rule.message });
    }
  }

  let advEvaluated = 0;
  let advPassed = 0;
  for (const rule of ADVISORY_RULES) {
    if (!rule.applies(payload, tier)) continue;
    advEvaluated += 1;
    const ok = rule.passes(payload, tier);
    if (ok) {
      advPassed += 1;
    } else {
      gaps.push({ ruleId: rule.ruleId, level: "ADVISORY", field: rule.field, message: rule.message });
    }
  }

  const canSubmit = blockingPassed === blockingEvaluated;

  const totalEvaluated = blockingEvaluated + rftEvaluated + advEvaluated;
  const totalPassed = blockingPassed + rftPassed + advPassed;
  const completenessPct = totalEvaluated === 0 ? 100 : Math.round((totalPassed / totalEvaluated) * 100);

  return { canSubmit, gaps, completenessPct };
}
