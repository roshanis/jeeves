import type { LifecycleState } from "../domain/types";
import { transition, type LifecycleAction } from "../lifecycle/transitions";

export interface ReviewDecisionReadiness {
  canApprove: boolean;
  canConditionallyApprove: boolean;
  canReject: boolean;
  hasRequiredDomains: boolean;
  approvalBlockers: string[];
  conditionalBlockers: string[];
  reason: string;
}

/** Readiness is a projection, not authorization. Callers still enforce the
 * actual actor, workspace and exact cycle inside the decision transaction. */
export function reviewDecisionReadiness(input: {
  state: LifecycleState;
  cycleOpen: boolean;
  requiredDomains: readonly string[] | null;
  reviews: readonly {
    domain: string;
    status: string;
    /** Supplied only after validating the exact current abstention receipt. */
    abstention?: { reason: string; reviewer: string; at: string } | null;
  }[];
}): ReviewDecisionReadiness {
  const allows = (action: LifecycleAction) => {
    if (!input.cycleOpen) return false;
    try {
      transition(input.state, action, { id: "readiness", role: "approver" }, { ts: 0 });
      return true;
    } catch { return false; }
  };
  const hasRequiredDomains = Boolean(input.requiredDomains?.length);
  const byDomain = new Map(input.reviews.map((row) => [row.domain, row]));
  const isAbstained = (domain: string) => {
    const row = byDomain.get(domain);
    return row?.status === "abstained" && Boolean(row.abstention);
  };
  const abstained = (input.requiredDomains ?? []).filter(isAbstained).length;
  const blockers = (accepted: string[]) => (input.requiredDomains ?? []).flatMap((domain) => {
    const status = byDomain.get(domain)?.status ?? "missing";
    return accepted.includes(status) || isAbstained(domain) ? [] : [`${domain}:${status}`];
  });
  const approvalBlockers = blockers(["signed"]);
  const conditionalBlockers = blockers(["signed", "drafted"]);
  const canApprove = allows("approve") && hasRequiredDomains && approvalBlockers.length === 0;
  const canConditionallyApprove = allows("conditionally_approve") && hasRequiredDomains && conditionalBlockers.length === 0;
  const reason = !input.cycleOpen ? "No open review cycle."
    : !allows("approve") ? "No review decision is available."
    : !hasRequiredDomains ? "Required review domains are unavailable."
    : canApprove ? abstained === input.requiredDomains!.length
      ? "All required reviewers abstained; ready for an approver decision."
      : abstained > 0
        ? `All participating reviews signed; ${abstained} abstained. Ready for an approver decision.`
        : "All required reviews signed; ready for approval."
    : canConditionallyApprove ? abstained > 0
      ? `Ready for conditional approval; ${abstained} abstained, participating signatures still pending.`
      : "Ready for conditional approval; signatures still pending."
    : "Required reviews are incomplete.";
  return { canApprove, canConditionallyApprove, canReject: allows("reject"), hasRequiredDomains, approvalBlockers, conditionalBlockers, reason };
}
