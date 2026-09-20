import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EvidenceState } from "@/lib/evidence/types";
import { ApiError } from "@/lib/client/api";
import { useState } from "react";

const mocks = vi.hoisted(() => ({ session: vi.fn(), request: vi.fn(), download: vi.fn(), refresh: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/evidence-api", () => ({ evidenceRequest: mocks.request, downloadEvidenceFile: mocks.download }));
vi.mock("@/lib/client/review-actions", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/client/review-actions")>(), performReviewMutation: mocks.mutate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ReviewEvidenceWorkspace } from "@/components/jeeves/review-evidence-workspace";
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { renderWithProviders } from "./helpers";

const session = { token: "reviewer-token", workspaceId: "workspace", personaKey: "marcus-webb", personaLabel: "Marcus Webb", role: "reviewer", expiresAt: Date.now() + 60_000 };
const entry = { controlId: "H-01", documentId: "document-v2", pageReference: "4–5", note: "Retention is described on these pages." };
function fixture(): EvidenceState {
  return {
    initiativeId: "initiative", cycleId: "cycle", canEdit: false, reviewerDomain: "privacy-hipaa", usedBytes: 100,
    documents: [{ id: "document-v2", fileName: "retention-v2.pdf", mediaType: "application/pdf", byteSize: 100, sha256: "a".repeat(64), scanStatus: "not_scanned", version: 2, supersedesId: "document-v1", uploadedBy: "requester", createdAt: "2026-09-19T12:00:00Z" }],
    requirements: [{ id: "H-01", name: "Retention policy", domain: "privacy-hipaa", description: "A retention policy is required.", policySource: "MP-H v3 §MP-H-2", status: "submitted", entry, assessment: null, signed: false }],
    draft: null, latest: { id: "packet-2", cycleId: "cycle", version: 2, revision: 1, status: "submitted", entries: [entry], submittedAt: "2026-09-19T12:05:00Z" }, history: [],
  };
}
function workspace(slug = "case-one") {
  return <ReviewEvidenceWorkspace slug={slug} domain="privacy-hipaa" citations={["MP-H v3 §MP-H-2"]} reviewStatus="drafted">
    {({ signingBlock, cycleId }) => <aside aria-label="Test review action"><span>{signingBlock ?? "No evidence signature block"}</span><span>{cycleId}</span></aside>}
  </ReviewEvidenceWorkspace>;
}
beforeEach(() => {
  mocks.session.mockReturnValue({ session, logout: vi.fn(), openUnlockPrompt: vi.fn() });
  mocks.request.mockResolvedValue(fixture());
  mocks.mutate.mockResolvedValue({ status: "signed" });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("evidence-led review", () => {
  it("shows the submitted document and page references, never an unsubmitted replacement", async () => {
    const state = fixture();
    state.documents.push({ ...state.documents[0], id: "unsubmitted", fileName: "unsubmitted.pdf", version: 3 });
    state.draft = { ...state.latest!, id: "draft", status: "draft", entries: [{ ...entry, documentId: "unsubmitted" }] };
    mocks.request.mockResolvedValue(state);
    render(workspace());
    expect(await screen.findByRole("heading", { name: "retention-v2.pdf" })).toBeTruthy();
    expect(screen.getByText("4–5")).toBeTruthy();
    expect(screen.getByText(entry.note)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "unsubmitted.pdf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download submitted document" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("case-one", "reviewer-token", "document-v2", "retention-v2.pdf"));
  });

  it("records a reason against the exact packet and requirement, then refreshes acceptance", async () => {
    const state = fixture();
    mocks.request.mockImplementation((_slug, _token, body) => {
      if (body) {
        state.requirements[0] = { ...state.requirements[0], status: "accepted", assessment: { id: "assessment", packetId: "packet-2", controlId: "H-01", decision: "accepted", reason: body.reason, reviewer: "Marcus Webb", reviewedAt: "2026-09-19T13:00:00Z", inherited: false } };
        return Promise.resolve({});
      }
      return Promise.resolve(structuredClone(state));
    });
    render(workspace());
    const accept = await screen.findByRole("button", { name: "Accept evidence" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Evidence assessment reason"), { target: { value: "The submitted scope is documented." } });
    fireEvent.click(accept);
    await screen.findByText("No evidence signature block");
    expect(mocks.request).toHaveBeenCalledWith("case-one", "reviewer-token", { action: "assess", packetId: "packet-2", controlId: "H-01", decision: "accepted", reason: "The submitted scope is documented." });
    expect(screen.queryByRole("button", { name: "Accept evidence" })).toBeNull();
  });

  it.each(["requester", "admin", "other reviewer"])("does not offer evidence assessment to %s", async (role) => {
    mocks.session.mockReturnValue({ session: { ...session, role: role === "other reviewer" ? "reviewer" : role, personaKey: role === "other reviewer" ? "james-liu" : role }, logout: vi.fn() });
    render(workspace());
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect(screen.queryByLabelText("Evidence assessment reason")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept evidence" })).toBeNull();
  });

  it("blocks signing an accepted packet when its required binding has an unsubmitted revision", async () => {
    const state = fixture();
    state.requirements[0].status = "accepted";
    state.draft = { ...state.latest!, id: "draft", status: "draft", entries: [{ ...entry, note: "A changed rationale." }] };
    mocks.request.mockResolvedValue(state);
    render(workspace());
    expect(await screen.findByText(/An evidence revision is still a draft/)).toBeTruthy();
  });

  it("preserves the legacy no-packet sign contract without calling missing evidence accepted", async () => {
    const state = fixture();
    state.latest = null;
    state.documents = [];
    state.requirements[0] = { ...state.requirements[0], entry: null, status: "missing" };
    mocks.request.mockResolvedValue(state);
    render(workspace());
    expect(await screen.findByText("No evidence signature block")).toBeTruthy();
    expect(screen.getByText("No evidence submitted yet.")).toBeTruthy();
    expect(screen.queryByText("Reviewer accepted")).toBeNull();
  });

  it("keeps external sources explicitly disconnected without requesting a provider", async () => {
    render(workspace());
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    fireEvent.click(screen.getByRole("button", { name: /Arize evaluations/ }));
    expect(screen.getByRole("heading", { name: "Evaluation evidence is not connected" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /W&B training provenance/ }));
    expect(screen.getByRole("heading", { name: "Training provenance is not connected" })).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("discards private evidence immediately on session change and ignores a late old response", async () => {
    let resolveOld!: (value: EvidenceState) => void;
    mocks.request.mockImplementationOnce(() => new Promise<EvidenceState>((resolve) => { resolveOld = resolve; }));
    const view = render(workspace());
    mocks.session.mockReturnValue({ session: { ...session, token: "other-token", workspaceId: "other-workspace" }, logout: vi.fn() });
    mocks.request.mockRejectedValue(new ApiError(404, "Evidence workspace not found."));
    view.rerender(workspace());
    await screen.findByText(/Shared examples do not have private evidence packets/);
    resolveOld(fixture());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "retention-v2.pdf" })).toBeNull());
  });

  it("shows a retry and keeps signing blocked when evidence cannot be checked", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Network unavailable"));
    render(workspace());
    await screen.findByRole("alert");
    expect(screen.getByText(/Evidence could not be checked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry evidence" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
  });

  it("preserves a route to existing domain actions when the evidence service is unavailable", async () => {
    mocks.request.mockRejectedValue(new ApiError(503, "Evidence is temporarily unavailable. Please try again."));
    render(workspace());
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Open initiative reviews" }).getAttribute("href")).toBe("/initiatives/case-one?tab=reviews");
  });

  it("does not bind an older visible review to evidence from a newer cycle", async () => {
    render(<ReviewEvidenceWorkspace slug="case-one" domain="privacy-hipaa" citations={[]} reviewStatus="drafted" reviewCycleId="older-cycle">
      {({ signingBlock, cycleId }) => <aside><span>{signingBlock}</span><span data-testid="action-cycle">{cycleId}</span></aside>}
    </ReviewEvidenceWorkspace>);
    expect(await screen.findByText(/A newer review cycle is available/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept evidence" })).toBeNull();
    expect(screen.getByTestId("action-cycle").textContent).toBe("");
    expect(screen.queryByRole("heading", { name: "retention-v2.pdf" })).toBeNull();
  });

  it("disables real review actions on a cycle mismatch and keeps human drafts scoped to their cycle", async () => {
    const row: ReviewQueueRow = { slug: "case-one", title: "Changing cycle", tier: "high", review: { revision: 4, cycleId: "cycle", domain: "privacy-hipaa", status: "drafted", reviewer: null, createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Original draft", citations: [] } };
    function Harness() {
      const [cycleId, setCycleId] = useState("cycle");
      return <><button onClick={() => setCycleId("new-cycle")}>Load new review</button><ReviewWorkbench rows={[{ ...row, review: { revision: 4, ...row.review, cycleId, draftMd: cycleId === "cycle" ? "Original draft" : "New cycle draft" } }]} /></>;
    }
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Changing cycle" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "Older cycle human finding" } });
    const newer = fixture();
    newer.cycleId = "new-cycle";
    newer.latest = { ...newer.latest!, cycleId: "new-cycle" };
    mocks.request.mockResolvedValue(newer);
    fireEvent.click(screen.getByRole("button", { name: "Refresh evidence" }));
    await screen.findByText(/A newer review cycle is available/);
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Return" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Re-run agent" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "retention-v2.pdf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load new review" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("New cycle draft");
  });

  it("keeps public visitors read-only and makes no private evidence request", () => {
    mocks.session.mockReturnValue(null);
    render(workspace());
    expect(screen.getByText(/Enter the demo passcode to view private submitted evidence/)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("preserves a human draft while switching sources and reviews", async () => {
    const rows: ReviewQueueRow[] = ["one", "two"].map((slug) => ({ slug, title: `Case ${slug}`, tier: "high", review: { revision: 4, domain: "privacy-hipaa", status: "drafted", reviewer: null, createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Agent draft", citations: ["MP-H v3 §MP-H-2"] } }));
    renderWithProviders(<ReviewWorkbench rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Case one" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "My source-grounded finding" } });
    fireEvent.click(screen.getByRole("button", { name: /Arize evaluations/ }));
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("My source-grounded finding");
    fireEvent.click(screen.getByRole("button", { name: "Change review" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Case two" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("Agent draft");
    fireEvent.click(screen.getByRole("button", { name: "Change review" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Case one" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("My source-grounded finding");
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the authenticated evidence cycle after a reload and enables sign only when the packet is accepted", async () => {
    const state = fixture();
    state.requirements[0].status = "accepted";
    mocks.request.mockResolvedValue(state);
    const row: ReviewQueueRow = { slug: "unregistered", title: "Reloaded case", tier: "high", review: { revision: 4, domain: "privacy-hipaa", status: "drafted", reviewer: null, createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Agent draft", citations: [] } };
    function Harness() {
      const [, update] = useState(0);
      return <><button onClick={() => update((value) => value + 1)}>Refresh session</button><ReviewWorkbench rows={[row]} /></>;
    }
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Reloaded case" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(false);
    mocks.session.mockReturnValue({ session: { ...session, token: "different-session", personaKey: "james-liu" }, logout: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Refresh session" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).disabled).toBe(true);
  });
});


describe("review snapshot integrity", () => {
  const row: ReviewQueueRow = { slug: "case-one", title: "Versioned case", tier: "high", review: { cycleId: "cycle", revision: 4, domain: "privacy-hipaa", status: "drafted", reviewer: null, createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Original assessment", citations: [] } };
  function acceptedEvidence() {
    const state = fixture();
    state.requirements[0].status = "accepted";
    mocks.request.mockResolvedValue(state);
  }
  async function openReview() {
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy/HIPAA review for Versioned case" }));
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
  }
  it("binds a signature to the displayed review revision and submitted evidence packet", async () => {
    acceptedEvidence();
    renderWithProviders(<ReviewWorkbench rows={[row]} />);
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith("reviewer-token", "cycle", "privacy-hipaa", { kind: "sign", expectedRevision: 4, expectedEvidencePacketId: "packet-2", editedDraftMd: undefined }));
  });
  it("preserves human edits across a newer render and requires explicit re-review", async () => {
    acceptedEvidence();
    function Harness() {
      const [revision, setRevision] = useState(4);
      return <><button onClick={() => setRevision(5)}>Load newer revision</button><ReviewWorkbench rows={[{ ...row, review: { ...row.review, revision, draftMd: revision === 4 ? "Original assessment" : "New agent assessment" } }]} /></>;
    }
    renderWithProviders(<Harness />);
    await openReview();
    fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "My careful edits" } });
    fireEvent.click(screen.getByRole("button", { name: "Load newer revision" }));
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("My careful edits");
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I reviewed the refreshed draft and evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith("reviewer-token", "cycle", "privacy-hipaa", { kind: "sign", expectedRevision: 5, expectedEvidencePacketId: "packet-2", editedDraftMd: "My careful edits" }));
  });
  it("requires re-review when retained edits were based on a different evidence packet", async () => {
    acceptedEvidence();
    renderWithProviders(<ReviewWorkbench rows={[row]} />);
    await openReview();
    fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "Finding based on packet two" } });
    const next = fixture();
    next.requirements[0].status = "accepted";
    next.latest = { ...next.latest!, id: "packet-3", version: 3 };
    mocks.request.mockResolvedValue(next);
    fireEvent.click(screen.getByRole("button", { name: "Refresh evidence" }));
    await screen.findByText("Submitted packet · v3");
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("Finding based on packet two");
    fireEvent.click(screen.getByRole("button", { name: "I reviewed the refreshed draft and evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith("reviewer-token", "cycle", "privacy-hipaa", { kind: "sign", expectedRevision: 4, expectedEvidencePacketId: "packet-3", editedDraftMd: "Finding based on packet two" }));
  });
  it("keeps edits after 409 and requires refreshing and re-reviewing before another signature", async () => {
    acceptedEvidence();
    mocks.mutate.mockRejectedValueOnce(new ApiError(409, "Review changed"));
    renderWithProviders(<ReviewWorkbench rows={[row]} />);
    await openReview();
    fireEvent.change(screen.getByLabelText("Assessment text"), { target: { value: "Retain this finding" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await screen.findByText(/Refresh.*review.*again/i);
    expect((screen.getByLabelText("Assessment text") as HTMLTextAreaElement).value).toBe("Retain this finding");
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("labels historical references as unverified and keeps missing evidence separate", async () => {
    render(<ReviewEvidenceWorkspace slug="case-one" domain="privacy-hipaa" citations={["Legacy stored text"]} citationProvenance="legacy-unverified" missingEvidence={["Missing retention policy"]} evidenceRequests={[{ controlId: "H-01", description: "Supply the policy version" }]} reviewStatus="drafted">{() => null}</ReviewEvidenceWorkspace>);
    await screen.findByRole("heading", { name: "retention-v2.pdf" });
    fireEvent.click(screen.getByRole("button", { name: /Legacy stored text/ }));
    expect(screen.getByText(/legacy.*unverified/i)).toBeTruthy();
    expect(screen.queryByText("Policy citation")).toBeNull();
    expect(screen.getByText("Missing retention policy")).toBeTruthy();
    expect(screen.getByText("H-01 · Supply the policy version")).toBeTruthy();
  });
});
