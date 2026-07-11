/**
 * Parser for `ControlDefinition.applicability` free-text strings
 * (seed-spec §3: "vendor=Y", "tier>=high", "member-facing=Y or
 * care-coverage=Y", "PHI=Y and vendor=Y", "all", etc.) against a tier +
 * OverlayFlags pair. Used by `initiative-service.ts#generateEffectiveControls`
 * to select which catalog rows apply to a given initiative.
 *
 * Deliberately narrow: only the exact vocabulary seed-spec §3 actually uses.
 * `Q-01`'s applicability ("all deployed initiatives with an eval_hallucination
 * series") is runtime/deployment-time, not review-time — callers exclude the
 * `runtime` domain before calling this parser (see initiative-service.ts).
 */
import type { OverlayFlags, Tier } from "../domain/types";

const TIER_ORDER: Record<Tier, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function evalAtom(atom: string, tier: Tier, flags: OverlayFlags): boolean {
  const a = atom.trim();
  if (a === "all") return true;
  if (a === "vendor=Y") return flags.vendorHosted;
  if (a === "member-facing=Y") return flags.memberFacing;
  if (a === "care-coverage=Y") return flags.careCoverageInfluence;
  if (a === "PHI=Y") return flags.phi;
  const tierGte = a.match(/^tier>=(\w+)$/);
  if (tierGte) {
    const threshold = tierGte[1] as Tier;
    return TIER_ORDER[tier] >= TIER_ORDER[threshold];
  }
  throw new Error(`applicabilityApplies: unrecognized atom "${a}"`);
}

/**
 * Evaluate a full applicability string. Supports:
 *   - a single atom ("vendor=Y", "all", "tier>=high", ...)
 *   - "A or B" (either atom true)
 *   - "A and B" (both atoms true)
 * No mixed/nested boolean expressions appear in seed-spec §3's catalog, so
 * this intentionally does not support operator precedence beyond a single
 * binary `or`/`and`.
 */
export function applicabilityApplies(
  applicability: string,
  tier: Tier,
  flags: OverlayFlags,
): boolean {
  const orParts = applicability.split(/\s+or\s+/);
  if (orParts.length > 1) {
    return orParts.some((part) => evalAtom(part, tier, flags));
  }
  const andParts = applicability.split(/\s+and\s+/);
  if (andParts.length > 1) {
    return andParts.every((part) => evalAtom(part, tier, flags));
  }
  return evalAtom(applicability, tier, flags);
}
