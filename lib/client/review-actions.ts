import type { LiveSession } from "./session-context";
import { domainForPersona } from "./personas";
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain } from "@/lib/domain/types";
import {
  returnReview,
  signReview,
  type DraftRunDomainOutcome,
} from "./api";

export interface ReviewActionEligibility {
  isOwnDomain: boolean;
  canEdit: boolean;
  canSignOrReturn: boolean;
  canRunAgent: boolean;
}

export function failedDraftRunDomains(outcomes: DraftRunDomainOutcome[]): Domain[] {
  return outcomes
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => outcome.domain);
}

export type ReviewMutation =
  | { kind: "sign"; editedDraftMd?: string }
  | { kind: "return"; reason: string };

export function performReviewMutation(
  token: string,
  cycleId: string,
  domain: Domain,
  mutation: ReviewMutation,
): Promise<unknown> {
  if (mutation.kind === "sign") {
    return signReview(token, cycleId, domain, mutation.editedDraftMd);
  }
  return returnReview(token, cycleId, domain, mutation.reason);
}

export function getReviewActionEligibility(
  session: LiveSession | null,
  cycleId: string | null,
  domain: Domain,
  status: ReviewRow["status"],
): ReviewActionEligibility {
  const isOwnDomain = Boolean(
    session?.role === "reviewer" && domainForPersona(session.personaKey) === domain,
  );
  const hasLiveCycle = Boolean(cycleId);
  const actionable = status === "drafted" || status === "returned";
  return {
    isOwnDomain,
    canEdit: isOwnDomain && hasLiveCycle && actionable,
    canSignOrReturn: isOwnDomain && hasLiveCycle && actionable,
    canRunAgent: isOwnDomain && hasLiveCycle && status !== "signed",
  };
}
