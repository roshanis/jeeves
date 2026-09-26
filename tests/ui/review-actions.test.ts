import { describe, expect, it } from "vitest";
import {
  failedDraftRunDomains,
  getReviewActionEligibility,
} from "@/lib/client/review-actions";

const reviewer = {
  token: "tok",
  workspaceId: "ws",
  expiresAt: Date.now() + 60_000,
  personaKey: "marcus-webb",
  personaLabel: "Marcus Webb",
  role: "reviewer" as const,
};

describe("review action eligibility", () => {
  it("allows only the authenticated reviewer's own actionable domain", () => {
    expect(getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", "drafted", 0).canEdit).toBe(true);
    expect(getReviewActionEligibility(reviewer, "cycle", "legal", "drafted", 0).canEdit).toBe(false);
  });

  it("does not allow pending or signed rows to be edited or acted on", () => {
    for (const status of ["pending", "signed"] as const) {
      const eligibility = getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", status, 0);
      expect(eligibility.canEdit).toBe(false);
      expect(eligibility.canSignOrReturn).toBe(false);
    }
  });

  it("does not grant a different reviewer domain through preview state", () => {
    const eligibility = getReviewActionEligibility(reviewer, "cycle", "clinical-safety", "returned", 0);
    expect(eligibility).toEqual({
      isOwnDomain: false,
      canEdit: false,
      canSignOrReturn: false,
      canRunAgent: false,
      canAbstain: false,
      canResume: false,
    });
  });

  it("selects only failed synchronous draft outcomes for retry", () => {
    expect(
      failedDraftRunDomains([
        { domain: "privacy-hipaa", status: "drafted" },
        { domain: "legal", status: "failed", error: "provider unavailable" },
        { domain: "security", status: "skipped", reason: "already signed" },
      ]),
    ).toEqual(["legal"]);
  });
});

 it("allows abstain only on the assigned live pending/drafted/returned review and requires resume afterward", () => {
   for (const status of ["pending", "drafted", "returned"] as const) {
     expect(getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", status, 0).canAbstain).toBe(true);
   }
   expect(getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", "abstained", 1)).toMatchObject({canAbstain: false, canResume: true, canEdit: false, canSignOrReturn: false, canRunAgent: false});
   for (const actor of [null, {...reviewer, role: "approver" as const}, {...reviewer, personaKey: "elena-vasquez"}]) {
     expect(getReviewActionEligibility(actor, "cycle", "privacy-hipaa", "abstained", 1).canResume).toBe(false);
     expect(getReviewActionEligibility(actor, "cycle", "privacy-hipaa", "drafted", 1).canAbstain).toBe(false);
   }
   expect(getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", "signed", 1).canAbstain).toBe(false);
   expect(getReviewActionEligibility(reviewer, null, "privacy-hipaa", "abstained", 1).canResume).toBe(false);
 });
