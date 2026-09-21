// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), startDraftRun: vi.fn(), runReviewAgent: vi.fn(), db: { select: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/services/route-guard", () => ({ runMutationGuard: mocks.guard }));
vi.mock("@/lib/workflow/review-run", () => ({ startDraftRun: mocks.startDraftRun, getRunProgress: vi.fn() }));
vi.mock("@/lib/services/initiative-service", () => ({
  runReviewAgent: mocks.runReviewAgent,
  ConflictError: class extends Error {}, IllegalTransitionError: class extends Error {},
  NotFoundError: class extends Error {}, ValidationError: class extends Error {},
}));
import { POST as fanOut } from "../initiatives/[id]/draft-run/route";
import { POST as single } from "../reviews/[cycleId]/[domain]/run/route";
import { ReviewIntegrityError } from "@/lib/services/review-integrity";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, actor: { role: "requester" }, workspaceId: null });
  mocks.db.select.mockReturnValue({ from: () => ({ where: async () => [{ workspaceId: null }] }) });
  mocks.startDraftRun.mockResolvedValue({ outcomes: [{ domain: "legal", status: "drafted" }] });
  mocks.runReviewAgent.mockResolvedValue({ status: "drafted" });
});
afterEach(() => vi.unstubAllEnvs());

describe("review route runtime reservations", () => {
  it.each([
    ["", "agents-sdk", "1", 1500, 60_000],
    ["   ", "agents-sdk", "1", 1500, 60_000],
    ["test-placeholder", "ai-sdk", "1", 1500, 60_000],
    ["test-placeholder", "unknown", "1", 1500, 60_000],
    ["test-placeholder", "agents-sdk", "0", 1500, 60_000],
    ["test-placeholder", "agents-sdk", "1", 15_000, 120_000],
  ])("passes actual runtime work to post-authorization reservation for key=%s runtime=%s deep=%s", async (key, runtime, deep, tokens, timeoutMs) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    const controller = new AbortController();
    const fanOutRequest = new Request("http://localhost/api/initiatives/i/draft-run", {
      method: "POST", body: JSON.stringify({ domains: ["legal", "security"] }), signal: controller.signal,
    });
    expect((await fanOut(fanOutRequest, { params: Promise.resolve({ id: "i" }) })).status).toBe(200);
    expect(mocks.guard).toHaveBeenLastCalledWith(fanOutRequest, undefined);
    expect(mocks.startDraftRun).toHaveBeenLastCalledWith(mocks.db, "i", ["legal", "security"], undefined, {
      actor: { role: "requester" }, sessionWorkspaceId: null, signal: fanOutRequest.signal,
      budget: expect.objectContaining({ tokensPerAttempt: tokens, dailyCap: 500_000 }),
      runTimeoutMs: timeoutMs,
    });
    const singleRequest = new Request("http://localhost/api/reviews/c/legal/run", { method: "POST", signal: controller.signal });
    expect((await single(singleRequest, { params: Promise.resolve({ cycleId: "c", domain: "legal" }) })).status).toBe(200);
    expect(mocks.guard).toHaveBeenLastCalledWith(singleRequest, undefined);
    expect(mocks.runReviewAgent).toHaveBeenLastCalledWith(mocks.db, "c", "legal", { role: "requester" }, null, undefined, {
      signal: singleRequest.signal, budget: expect.objectContaining({ tokensPerAttempt: tokens, dailyCap: 500_000 }),
      runTimeoutMs: timeoutMs,
    });
  });

  it("returns a conflict when a cycle closes before work can start", async () => {
    const message = "This review cycle is closed or no longer current. Refresh before continuing.";
    mocks.startDraftRun.mockRejectedValueOnce(new ReviewIntegrityError("conflict", message));
    mocks.runReviewAgent.mockRejectedValueOnce(new ReviewIntegrityError("conflict", message));
    const responses = [
      await fanOut(new Request("http://localhost/api/initiatives/i/draft-run", { method: "POST", body: JSON.stringify({ domains: ["legal"] }) }), { params: Promise.resolve({ id: "i" }) }),
      await single(new Request("http://localhost/api/reviews/c/legal/run", { method: "POST" }), { params: Promise.resolve({ cycleId: "c", domain: "legal" }) }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: message });
    }
  });
});
