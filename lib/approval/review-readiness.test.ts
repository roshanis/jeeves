import { describe, expect, it } from "vitest";
import { reviewDecisionReadiness } from "./review-readiness";

const input = { state: "in_review" as const, cycleOpen: true, requiredDomains: ["legal", "security"], reviews: [{ domain: "legal", status: "signed" }, { domain: "security", status: "signed" }] };
describe("review decision readiness", () => {
  it.each(["pending", "returned", "failed"])("blocks approval and conditional approval for a %s required review", (status) => {
    expect(reviewDecisionReadiness({ ...input, reviews: [input.reviews[0], { domain: "security", status }] }))
      .toMatchObject({ canApprove: false, canConditionallyApprove: false, canReject: true, approvalBlockers: [`security:${status}`] });
  });
  it("requires every domain even when rows are missing", () => {
    expect(reviewDecisionReadiness({ ...input, reviews: [] })).toMatchObject({ canApprove: false, canConditionallyApprove: false, approvalBlockers: ["legal:missing", "security:missing"] });
  });
  it.each([null, []])("fails closed without a required-domain set", (requiredDomains) => {
    expect(reviewDecisionReadiness({ ...input, requiredDomains })).toMatchObject({ hasRequiredDomains: false, canApprove: false, canConditionallyApprove: false, canReject: true });
  });
  it("allows conditional approval after all domains are drafted or signed", () => {
    expect(reviewDecisionReadiness({ ...input, reviews: [input.reviews[0], { domain: "security", status: "drafted" }] })).toMatchObject({ canApprove: false, canConditionallyApprove: true, conditionalBlockers: [] });
  });
  it("allows full approval only once every domain is signed", () => {
    expect(reviewDecisionReadiness(input)).toMatchObject({ canApprove: true, canConditionallyApprove: true });
  });
  it("keeps reassessment approval available but not conditional approval or rejection", () => {
    expect(reviewDecisionReadiness({ ...input, state: "re_review" })).toMatchObject({ canApprove: true, canConditionallyApprove: false, canReject: false });
  });
  it("does not route drafted reassessments to an unavailable conditional decision", () => {
    expect(reviewDecisionReadiness({ ...input, state: "re_review", reviews: input.reviews.map((r) => ({ ...r, status: "drafted" })) })).toMatchObject({ canApprove: false, canConditionallyApprove: false });
  });
  it.each(["conditionally_approved", "approved", "fast_lane_approved", "deployed"] as const)("excludes %s from the decision queue", (state) => {
    expect(reviewDecisionReadiness({ ...input, state })).toMatchObject({ canApprove: false, canConditionallyApprove: false, canReject: false });
  });
  it("blocks every decision on a closed cycle even when the initiative state is stale", () => {
    expect(reviewDecisionReadiness({ ...input, cycleOpen: false })).toMatchObject({ canApprove: false, canConditionallyApprove: false, canReject: false });
  });
});

const receipt = { reason: "Conflict of interest", reviewer: "reviewer", at: "2026-09-21T12:00:00Z" };
describe("nonblocking recorded abstention", () => {
  it.each(["signed", "drafted"])("continues with a %s participating reviewer and a recorded abstention", (status) => {
    const reviews = [{ domain: "legal", status }, { domain: "security", status: "abstained", abstention: receipt }];
    const result = reviewDecisionReadiness({ ...input, reviews });
    expect(result).toMatchObject({ canApprove: status === "signed", canConditionallyApprove: true, conditionalBlockers: [] });
    expect(result.reason).toMatch(/abstain/i);
    expect(result.reason).not.toMatch(/all required reviews signed/i);
  });
  it("lets a human decide when all required reviewers have recorded abstentions", () => {
    const reviews = input.reviews.map(row => ({ ...row, status: "abstained", abstention: receipt }));
    expect(reviewDecisionReadiness({ ...input, reviews })).toMatchObject({ canApprove: true, canConditionallyApprove: true, canReject: true });
  });
  it("keeps an abstention without a validated receipt blocking", () => {
    expect(reviewDecisionReadiness({ ...input, reviews: [{ domain: "legal", status: "signed" }, { domain: "security", status: "abstained" }] }))
      .toMatchObject({ canApprove: false, canConditionallyApprove: false, approvalBlockers: ["security:abstained"] });
  });
  it.each(["pending", "returned", "missing"])("does not hide another %s obligation", (status) => {
    const reviews = [{ domain: "legal", status: "abstained", abstention: receipt }, ...(status === "missing" ? [] : [{ domain: "security", status }])];
    expect(reviewDecisionReadiness({ ...input, reviews })).toMatchObject({ canApprove: false, canConditionallyApprove: false, approvalBlockers: [`security:${status}`] });
  });
});
