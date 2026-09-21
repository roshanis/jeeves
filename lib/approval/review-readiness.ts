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
  reviews: readonly { domain: string; status: string }[];
}): ReviewDecisionReadiness {
  const allows = (action: LifecycleAction) => {
    if (!input.cycleOpen) return false;
    try {
      transition(input.state, action, { id: "readiness", role: "approver" }, { ts: 0 });
      return true;
    } catch { return false; }
  };
  const hasRequiredDomains = Boolean(input.requiredDomains?.length);
  const byDomain = new Map(input.reviews.map((row) => [row.domain, row.status]));
  const blockers = (accepted: string[]) => (input.requiredDomains ?? []).flatMap((domain) => {
    const status = byDomain.get(domain) ?? "missing";
    return accepted.includes(status) ? [] : [`${domain}:${status}`];
  });
  const approvalBlockers = blockers(["signed"]);
  const conditionalBlockers = blockers(["signed", "drafted"]);
  const canApprove = allows("approve") && hasRequiredDomains && approvalBlockers.length === 0;
  const canConditionallyApprove = allows("conditionally_approve") && hasRequiredDomains && conditionalBlockers.length === 0;
  const reason = !input.cycleOpen ? "No open review cycle."
    : !allows("approve") ? "No review decision is available."
    : !hasRequiredDomains ? "Required review domains are unavailable."
    : canApprove ? "All required reviews signed; ready for approval."
    : canConditionallyApprove ? "Ready for conditional approval; signatures still pending."
    : "Required reviews are incomplete.";
  return { canApprove, canConditionallyApprove, canReject: allows("reject"), hasRequiredDomains, approvalBlockers, conditionalBlockers, reason };
}
