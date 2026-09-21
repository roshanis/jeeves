import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sign: vi.fn(), returnReview: vi.fn(), guard: vi.fn(), db: {} }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/services/route-guard", () => ({ runMutationGuard: mocks.guard }));
vi.mock("@/lib/services/initiative-service", () => ({
  signReview: mocks.sign,
  returnReview: mocks.returnReview,
  ConflictError: class ConflictError extends Error {},
  IllegalTransitionError: class IllegalTransitionError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
}));
import { POST as sign } from "../reviews/[cycleId]/[domain]/sign/route";
import { POST as returnReview } from "../reviews/[cycleId]/[domain]/return/route";
import { ConflictError } from "@/lib/services/initiative-service";
const context = { params: Promise.resolve({ cycleId: "cycle", domain: "privacy-hipaa" }) };
const actor = { role: "reviewer", name: "Marcus Webb" };
function request(body: unknown) { return new Request("http://localhost/api/reviews/cycle/privacy-hipaa/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ ok: true, actor, workspaceId: "workspace" }); mocks.sign.mockResolvedValue({ status: "signed" }); mocks.returnReview.mockResolvedValue({ status: "returned" }); });
describe("review mutation version requirements", () => {
  it.each([{}, { expectedRevision: 0 }, { expectedEvidencePacketId: null }, { expectedRevision: -1, expectedEvidencePacketId: null }, { expectedRevision: 0.5, expectedEvidencePacketId: null }])("rejects a missing or invalid signature snapshot: %j", async (body) => {
    expect((await sign(request(body), context)).status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("forwards exactly the caller's reviewed draft and packet identities", async () => {
    const body = { expectedRevision: 7, expectedEvidencePacketId: "packet-2", editedDraftMd: "Reviewed text" };
    expect((await sign(request(body), context)).status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledWith(mocks.db, "cycle", "privacy-hipaa", actor, "workspace", body);
  });
  it("supports explicit no-packet without inferring current evidence", async () => {
    const body = { expectedRevision: 0, expectedEvidencePacketId: null };
    expect((await sign(request(body), context)).status).toBe(200);
    expect(mocks.sign.mock.calls[0][5]).toEqual(body);
  });
  it("requires a revision on return and forwards it", async () => {
    expect((await returnReview(request({ reason: "Changes required" }), context)).status).toBe(400);
    expect(mocks.returnReview).not.toHaveBeenCalled();
    expect((await returnReview(request({ reason: "Changes required", expectedRevision: 7 }), context)).status).toBe(200);
    expect(mocks.returnReview).toHaveBeenCalledWith(mocks.db, "cycle", "privacy-hipaa", actor, "workspace", "Changes required", 7);
  });
  it("preserves stale-snapshot conflict status for the client", async () => {
    mocks.sign.mockRejectedValueOnce(new ConflictError("Review changed; refresh and review it again."));
    const response = await sign(request({ expectedRevision: 3, expectedEvidencePacketId: null }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/refresh/) });
  });
});
