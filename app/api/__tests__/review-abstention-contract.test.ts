import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ abstain: vi.fn(), resume: vi.fn(), guard: vi.fn(), db: {} }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/services/route-guard", () => ({ runMutationGuard: mocks.guard }));
vi.mock("@/lib/services/initiative-service", () => ({
  abstainReview: mocks.abstain, resumeReview: mocks.resume,
  ConflictError: class ConflictError extends Error {}, IllegalTransitionError: class IllegalTransitionError extends Error {},
  NotFoundError: class NotFoundError extends Error {}, ValidationError: class ValidationError extends Error {},
}));
import { POST as abstain } from "../reviews/[cycleId]/[domain]/abstain/route";
import { POST as resume } from "../reviews/[cycleId]/[domain]/resume/route";
import { ConflictError, IllegalTransitionError, NotFoundError, ValidationError } from "@/lib/services/initiative-service";
const context = { params: Promise.resolve({ cycleId: "cycle", domain: "privacy-hipaa" }) };
const actor = { id: "marcus-webb", role: "reviewer" };
const request = (body: unknown) => new Request("http://localhost/api/reviews/cycle/privacy-hipaa/abstain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ ok: true, actor, workspaceId: "workspace" }); mocks.abstain.mockResolvedValue({status:"abstained"}); mocks.resume.mockResolvedValue({status:"returned"}); });
describe("review abstention routes", () => {
  it.each([{}, {reason:""}, {reason:"  ",expectedRevision:0}, {reason:"Conflict"}, {reason:"x".repeat(2001),expectedRevision:0}, {reason:"Conflict",expectedRevision:-1}])("rejects missing reason/revision and invalid bodies", async (body) => {
    expect((await abstain(request(body), context)).status).toBe(400);
    expect(mocks.abstain).not.toHaveBeenCalled();
  });
  it("forwards actor, workspace, reason and exact revisions", async () => {
    expect((await abstain(request({reason:"Conflict of interest",expectedRevision:2}),context)).status).toBe(200);
    expect(mocks.abstain).toHaveBeenCalledWith(mocks.db,"cycle","privacy-hipaa",actor,"workspace","Conflict of interest",2);
    expect((await resume(request({expectedRevision:3}),context)).status).toBe(200);
    expect(mocks.resume).toHaveBeenCalledWith(mocks.db,"cycle","privacy-hipaa",actor,"workspace",3);
    expect((await resume(request({}),context)).status).toBe(400);
  });
  it.each([401,429])("preserves mutation guard status %s", async (status) => {
    mocks.guard.mockResolvedValue({ok:false,failure:{status,message:"Blocked"}});
    for (const route of [abstain,resume]) expect((await route(request({reason:"Conflict",expectedRevision:0}),context)).status).toBe(status);
    expect(mocks.abstain).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it.each([[new ConflictError("Denied"),409],[new IllegalTransitionError("Denied", "in_review", "start_review", "reviewer"),403],[new NotFoundError("review", "missing"),404],[new ValidationError("Denied"),400]] as const)("maps service errors", async (error,status) => {
    mocks.abstain.mockRejectedValue(error); mocks.resume.mockRejectedValue(error);
    for (const route of [abstain,resume]) expect((await route(request({reason:"Conflict",expectedRevision:0}),context)).status).toBe(status);
  });
});
