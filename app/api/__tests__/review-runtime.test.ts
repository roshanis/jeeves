// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  startDraftRun: vi.fn(),
  runReviewAgent: vi.fn(),
  db: { select: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/services/route-guard", () => ({ runMutationGuard: mocks.guard }));
vi.mock("@/lib/workflow/review-run", () => ({
  startDraftRun: mocks.startDraftRun,
  getRunProgress: vi.fn(),
  DraftRunConflictError: class extends Error {},
}));
vi.mock("@/lib/services/initiative-service", () => ({
  runReviewAgent: mocks.runReviewAgent,
  IllegalTransitionError: class extends Error {},
  NotFoundError: class extends Error {},
  ValidationError: class extends Error {},
}));

import { POST as fanOut } from "../initiatives/[id]/draft-run/route";
import { POST as single } from "../reviews/[cycleId]/[domain]/run/route";
import { DraftRunConflictError } from "@/lib/workflow/review-run";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, actor: { role: "requester" }, workspaceId: null });
  mocks.db.select.mockReturnValue({ from: () => ({ where: async () => [{ workspaceId: null }] }) });
  mocks.startDraftRun.mockResolvedValue({ outcomes: [] });
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
  ])("reserves actual runtime work for key=%s runtime=%s deep=%s", async (key, runtime, deep, tokens, timeoutMs) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    const controller = new AbortController();
    const fanOutRequest = new Request("http://localhost/api/initiatives/i/draft-run", {
      method: "POST", body: JSON.stringify({ domains: ["legal", "security"] }), signal: controller.signal,
    });
    expect((await fanOut(fanOutRequest, { params: Promise.resolve({ id: "i" }) })).status).toBe(200);
    expect(mocks.guard).toHaveBeenLastCalledWith(fanOutRequest, undefined, { requiresBudget: true, estimatedTokens: tokens * 2 });
    expect(mocks.startDraftRun).toHaveBeenLastCalledWith(mocks.db, "i", ["legal", "security"], undefined, { signal: fanOutRequest.signal, timeoutMs });

    const singleRequest = new Request("http://localhost/api/reviews/c/legal/run", { method: "POST", signal: controller.signal });
    expect((await single(singleRequest, { params: Promise.resolve({ cycleId: "c", domain: "legal" }) })).status).toBe(200);
    expect(mocks.guard).toHaveBeenLastCalledWith(singleRequest, undefined, { requiresBudget: true, estimatedTokens: tokens });
    expect(mocks.runReviewAgent).toHaveBeenLastCalledWith(mocks.db, "c", "legal", { role: "requester" }, null, undefined, { signal: singleRequest.signal, timeoutMs });
  });

  it("reserves once per requested domain when the request contains duplicates", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const request = new Request("http://localhost/api/initiatives/i/draft-run", {
      method: "POST", body: JSON.stringify({ domains: ["legal", "legal"] }),
    });
    expect((await fanOut(request, { params: Promise.resolve({ id: "i" }) })).status).toBe(200);
    expect(mocks.guard).toHaveBeenLastCalledWith(request, undefined, { requiresBudget: true, estimatedTokens: 1500 });
  });

  it("returns a safe conflict when a review cycle closes before work can start", async () => {
    mocks.startDraftRun.mockRejectedValueOnce(new DraftRunConflictError("closed internal-cycle-id"));
    mocks.runReviewAgent.mockRejectedValueOnce(new DraftRunConflictError("closed internal-cycle-id"));
    const fanOutResponse = await fanOut(new Request("http://localhost/api/initiatives/i/draft-run", {
      method: "POST", body: JSON.stringify({ domains: ["legal"] }),
    }), { params: Promise.resolve({ id: "i" }) });
    const singleResponse = await single(new Request("http://localhost/api/reviews/c/legal/run", { method: "POST" }), {
      params: Promise.resolve({ cycleId: "c", domain: "legal" }),
    });
    for (const response of [fanOutResponse, singleResponse]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Review changed or the cycle closed. Refresh before running again." });
    }
  });
});
