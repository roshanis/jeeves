import type { OverlayFlags, Tier } from "../domain/types";

/**
 * Deterministic tier derivation from intake overlay flags.
 *
 * Implements seed-spec §2.1 EXACTLY, first match wins:
 *   1. care-coverage ∧ ¬human-in-loop -> Critical
 *   2. care-coverage ∧ human-in-loop   -> High
 *   3. PHI                             -> High
 *   4. member-facing ∧ individual-impact -> High
 *   5. individual-impact                -> Medium
 *   6. member-facing                    -> Medium
 *   7. otherwise                        -> Low
 */
export function deriveTier(flags: OverlayFlags): Tier {
  if (flags.careCoverageInfluence && !flags.humanInLoop) {
    return "critical";
  }
  if (flags.careCoverageInfluence && flags.humanInLoop) {
    return "high";
  }
  if (flags.phi) {
    return "high";
  }
  if (flags.memberFacing && flags.individualImpact) {
    return "high";
  }
  if (flags.individualImpact) {
    return "medium";
  }
  if (flags.memberFacing) {
    return "medium";
  }
  return "low";
}
