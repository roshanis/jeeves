import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./helpers";
import { ApiError } from "@/lib/client/api";
import type { ReviewRow } from "@/lib/data/dto";
const mocks = vi.hoisted(() => ({ mutation: vi.fn(), request: vi.fn(), refresh: vi.fn(), draftRun: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));
vi.mock("@/lib/client/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/client/api")>(), startDraftRun: mocks.draftRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/use-live-info", () => ({ useLiveInfo: () => ({ cycleId: "cycle", initiativeId: "initiative" }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: () => ({ session: { token: "token", workspaceId: "workspace", role: "reviewer", personaKey: "marcus-webb" } }) }));
vi.mock("@/lib/client/evidence-api", () => ({ evidenceRequest: mocks.request, downloadEvidenceFile: vi.fn() }));
vi.mock("@/lib/client/review-actions", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/client/review-actions")>(), performReviewMutation: mocks.mutation }));
import { ReviewsTab } from "@/components/jeeves/reviews-tab";
const review: ReviewRow = { cycleId: "cycle", revision: 4, domain: "privacy-hipaa", status: "drafted", draftMd: "Reviewed draft", citations: [], reviewer: null, signedAt: null, createdAt: "2026-09-19T12:00:00Z" };
beforeEach(() => {
  mocks.mutation.mockResolvedValue({ status: "signed" });
  mocks.request.mockResolvedValue({ initiativeId: "initiative", cycleId: "cycle", documents: [], requirements: [], draft: null, latest: { id: "packet-4", cycleId: "cycle", version: 4, revision: 0, status: "submitted", entries: [], submittedAt: "2026-09-19T12:00:00Z" }, history: [], canEdit: false, reviewerDomain: "privacy-hipaa", usedBytes: 0 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("initiative review actions", () => {
  it.each(["already running", "superseded"])("keeps an incomplete %s domain selected without claiming completion", async (reason) => {
    mocks.draftRun.mockResolvedValue({ cycleId: "cycle", runId: "run", outcomes: [{ domain: "privacy-hipaa", status: "skipped", reason }] });
    renderWithProviders(<ReviewsTab slug="case-one" reviews={[{ ...review, status: "pending", draftMd: null }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Start draft run (1 domains)" }));
    await screen.findByRole("button", { name: "Retry remaining domains (1)" });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(expect.stringMatching(/did not complete/i));
  });
  it("opens the exact row's evidence before allowing a signature", async () => {
    renderWithProviders(<ReviewsTab slug="case-one" reviews={[review]} />);
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review & sign" }));
    await screen.findByText("Submitted packet · v4");
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("token", "cycle", "privacy-hipaa", { kind: "sign", expectedRevision: 4, expectedEvidencePacketId: "packet-4" }));
  });
  it("retains the written return reason after a conflict closes the dialog", async () => {
    mocks.mutation.mockRejectedValueOnce(new ApiError(409, "Review changed"));
    renderWithProviders(<ReviewsTab slug="case-one" reviews={[review]} />);
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Keep this specific finding" } });
    fireEvent.click(screen.getByRole("button", { name: "Return review" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Keep this specific finding");
  });
  it("does not silently switch a return dialog to a newer displayed revision", async () => {
    function Harness() {
      const [revision, setRevision] = useState(4);
      return <><button onClick={() => setRevision(5)}>Load updated review</button><ReviewsTab slug="case-one" reviews={[{ ...review, revision }]} /></>;
    }
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Missing policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Load updated review", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Return review" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("token", "cycle", "privacy-hipaa", { kind: "return", reason: "Missing policy", expectedRevision: 4 }));
  });
});
