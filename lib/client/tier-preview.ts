/**
 * Client-side live tier preview for the intake form (ui-spec §4.5).
 *
 * Imports the REAL `deriveTier` (lib/triage/rules.ts) and
 * `requiredDomains` (lib/triage/routing.ts) — both pure functions — so the
 * preview can never drift from the server-side triage that runs on submit.
 * The only logic owned here is the key mapping between the intake payload's
 * long overlay keys (`touchesPHI`, `humanInTheLoop`, …) and the domain
 * `OverlayFlags` short keys (`phi`, `humanInLoop`, …), plus display copy
 * for which rule matched.
 */
import type { Domain, OverlayFlags, Tier } from "@/lib/domain/types";
import type { IntakeOverlay } from "@/lib/intake/types";
import { deriveTier } from "@/lib/triage/rules";
import { requiredDomains } from "@/lib/triage/routing";

/**
 * Maps the intake payload overlay (long keys, nullable while the form is
 * incomplete) to `OverlayFlags` (short keys, all boolean). Returns null
 * until all 6 questions are answered — the preview shows a placeholder
 * until then.
 */
export function overlayToFlags(overlay: IntakeOverlay): OverlayFlags | null {
  const {
    touchesPHI,
    memberFacing,
    careCoverageInfluence,
    vendorHosted,
    humanInTheLoop,
    individualImpact,
  } = overlay;
  if (
    typeof touchesPHI !== "boolean" ||
    typeof memberFacing !== "boolean" ||
    typeof careCoverageInfluence !== "boolean" ||
    typeof vendorHosted !== "boolean" ||
    typeof humanInTheLoop !== "boolean" ||
    typeof individualImpact !== "boolean"
  ) {
    return null;
  }
  return {
    phi: touchesPHI,
    memberFacing,
    careCoverageInfluence,
    vendorHosted,
    humanInLoop: humanInTheLoop,
    individualImpact,
  };
}

/**
 * Display-only explanation of which deriveTier rule matched — mirrors
 * lib/triage/rules.ts (first match wins) and the phrasing already used by
 * components/jeeves/overview-tab.tsx. The authoritative tier is always the
 * `deriveTier` return value, never this string.
 */
export function tierRuleText(flags: OverlayFlags): string {
  if (flags.careCoverageInfluence && !flags.humanInLoop) {
    return "Rule 1: care-coverage ∧ ¬human-in-loop → Critical";
  }
  if (flags.careCoverageInfluence && flags.humanInLoop) {
    return "Rule 2: care-coverage ∧ human-in-loop → High";
  }
  if (flags.phi) {
    return "Rule 3: PHI → High";
  }
  if (flags.memberFacing && flags.individualImpact) {
    return "Rule 4: member-facing ∧ individual-impact → High";
  }
  if (flags.individualImpact) {
    return "Rule 5: individual-impact → Medium";
  }
  if (flags.memberFacing) {
    return "Rule 6: member-facing → Medium";
  }
  return "Rule 7: no overlay flags → Low";
}

export interface TierPreview {
  tier: Tier;
  ruleText: string;
  requiredDomains: Domain[];
}

/** Full live preview: tier + matched rule + required domains (sorted). */
export function previewTier(overlay: IntakeOverlay): TierPreview | null {
  const flags = overlayToFlags(overlay);
  if (!flags) return null;
  const tier = deriveTier(flags);
  return {
    tier,
    ruleText: tierRuleText(flags),
    requiredDomains: [...requiredDomains(tier, flags)].sort() as Domain[],
  };
}
