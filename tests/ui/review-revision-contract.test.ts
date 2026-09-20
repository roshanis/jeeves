import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiErrorToMessage, signReview, returnReview } from "@/lib/client/api";
import { getReviewActionEligibility } from "@/lib/client/review-actions";

const reviewer = { token: "token", workspaceId: "workspace", personaKey: "marcus-webb", personaLabel: "Marcus Webb", role: "reviewer" as const, expiresAt: 1 };
afterEach(() => vi.unstubAllGlobals());

describe("review revision wire contract", () => {
  it("sends the rendered revision and exact observed packet, including explicit no-packet", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "signed" })));
    vi.stubGlobal("fetch", fetch);
    await signReview("token", "cycle", "privacy-hipaa", { expectedRevision: 4, expectedEvidencePacketId: "packet-2", editedDraftMd: "Human assessment" });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expectedRevision: 4, expectedEvidencePacketId: "packet-2", editedDraftMd: "Human assessment" });
    fetch.mockResolvedValue(new Response(JSON.stringify({ status: "signed" })));
    await signReview("token", "cycle", "privacy-hipaa", { expectedRevision: 5, expectedEvidencePacketId: null });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedRevision: 5, expectedEvidencePacketId: null });
  });

  it("returns only the revision on which the reviewer opened the dialog", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "returned" })));
    vi.stubGlobal("fetch", fetch);
    await returnReview("token", "cycle", "privacy-hipaa", "Missing evidence", 4);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ reason: "Missing evidence", expectedRevision: 4 });
  });

  it("keeps legacy rows without revision read-only until fresh data arrives", () => {
    const eligibility = getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", "drafted");
    expect(eligibility.canEdit).toBe(false);
    expect(eligibility.canSignOrReturn).toBe(false);
    expect(eligibility.canRunAgent).toBe(false);
    expect(getReviewActionEligibility(reviewer, "cycle", "privacy-hipaa", "drafted", 0).canSignOrReturn).toBe(true);
  });

  it("explains conflict recovery without suggesting a blind retry", () => {
    expect(apiErrorToMessage(new ApiError(409, "Conflict"))).toMatch(/refresh.*review/i);
  });
});
