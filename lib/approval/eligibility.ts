import type { OverlayFlags, Tier } from "../domain/types";

/**
 * Configuration for a pre-approved fast-lane policy. Never hardcode these
 * values in the eligibility logic — always thread them through from the
 * caller's policy config (plan §1: "deterministic fast-lane under a
 * pre-approved policy with a named accountable approver").
 */
export interface FastLanePolicy {
  policyId: string;
  accountableApprover: string;
}

export interface FastLaneEligibilityInput {
  tier: Tier;
  intakeComplete: boolean;
  flags: OverlayFlags;
  policy: FastLanePolicy;
}

export interface FastLaneEligibilityResult {
  eligible: boolean;
  /** Every failed criterion, in evaluation order. Empty when eligible. */
  reasons: string[];
  policyId: string;
  accountableApprover: string;
}

/**
 * Fast-lane eligibility (plan §1, §8 test 3; seed-spec #2 marketing-ab-tester).
 *
 * Eligible iff:
 *   tier === 'low' AND intakeComplete AND !phi AND !memberFacing AND !careCoverageInfluence
 *
 * All failed criteria are reported (not just the first), so a caller can
 * show the requester everything that needs to change.
 */
export function fastLaneEligibility(
  input: FastLaneEligibilityInput,
): FastLaneEligibilityResult {
  const { tier, intakeComplete, flags, policy } = input;
  const reasons: string[] = [];

  if (tier !== "low") {
    reasons.push("tier is not low");
  }
  if (!intakeComplete) {
    reasons.push("intake is not complete");
  }
  if (flags.phi) {
    reasons.push("initiative touches PHI");
  }
  if (flags.memberFacing) {
    reasons.push("initiative is member-facing");
  }
  if (flags.careCoverageInfluence) {
    reasons.push("initiative influences care or coverage decisions");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    policyId: policy.policyId,
    accountableApprover: policy.accountableApprover,
  };
}
