// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Actor } from "../domain/types";
import type { AgentPort, DraftReviewInput, DraftReviewOutput, PortFailure } from "../agents/ports";
import { createMockAgentPort } from "../agents/mock-adapter";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, initiatives, intakeVersions, reviewCycles, reviewDecisions, riskAssessments, runBudget } from "../db/schema";
import { runReviewAgent } from "../services/initiative-service";
import { draftBudgetPolicy } from "./draft-execution-policy";
import { startDraftRun } from "./review-run";

const at = new Date("2026-09-19T10:00:00Z");
const reviewer: Actor = { id: "james-liu", role: "reviewer" };
const budget = { day: "2026-09-19", dailyCap: 500_000, tokensPerAttempt: 1_500 };
const options = { budget, actor: reviewer, sessionWorkspaceId: "workspace-a", retryDelayMs: 0 };
let db: TestDb;

function success(input: DraftReviewInput): DraftReviewOutput {
  return { domain: input.domain, draftMarkdown: "Synthetic draft", recommendation: "recommend-sign-off", suggestedConditions: [], missingEvidence: [], citations: [] };
}

function mockPort() {
  const draftReview = vi.fn<AgentPort["draftReview"]>().mockImplementation(async (input) => ({ ok: true, value: success(input) }));
  return { port: { ...createMockAgentPort(), draftReview }, draftReview };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function reservations() {
  return db.select().from(auditEvents).where(eq(auditEvents.action, "draft_budget_reserved"));
}

async function tokensUsed() {
  const [row] = await db.select().from(runBudget).where(eq(runBudget.day, budget.day));
  return row?.tokensUsed ?? 0;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(initiatives).values({ id: "i", slug: "budget-fixture", title: "Fictional review", requester: "Priya Raman", state: "in_review", workspaceId: "workspace-a", createdAt: at, updatedAt: at });
  await db.insert(intakeVersions).values({ id: "iv", initiativeId: "i", version: 1, submitted: true, fields: { useCase: "Synthetic test" }, createdAt: at });
  await db.insert(riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "iv", tier: "high", flags: {}, requiredDomains: ["legal", "security"], createdAt: at });
  await db.insert(reviewCycles).values({ id: "cycle", initiativeId: "i", kind: "initial", riskAssessmentId: "risk", openedAt: at });
  await db.insert(reviewDecisions).values([
    { id: "review-legal", cycleId: "cycle", domain: "legal", status: "pending", createdAt: at },
    { id: "review-security", cycleId: "cycle", domain: "security", status: "pending", createdAt: at },
  ]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeTestDb(db);
});

describe("draft attempt reservations", () => {
  const unauthorized: { label: string; actor: Actor; workspace: string }[] = [
    { label: "requester", actor: { id: "priya-raman", role: "requester" }, workspace: "workspace-a" },
    { label: "admin", actor: { id: "ray-chen", role: "admin" }, workspace: "workspace-a" },
    { label: "approver", actor: { id: "angela-torres", role: "approver" }, workspace: "workspace-a" },
    { label: "another domain reviewer", actor: { id: "elena-vasquez", role: "reviewer" }, workspace: "workspace-a" },
    { label: "another workspace", actor: reviewer, workspace: "workspace-b" },
  ];
  it.each(unauthorized)("rejects $label before reserving capacity or invoking the provider", async ({ actor, workspace }) => {
    const { port, draftReview } = mockPort();
    await expect(runReviewAgent(db, "cycle", "legal", actor, workspace, port, { budget })).rejects.toThrow();
    expect(draftReview).not.toHaveBeenCalled();
    expect(await db.select().from(runBudget)).toEqual([]);
    expect(await reservations()).toEqual([]);
  });

  it("reserves once for duplicate domains, concurrent invocations and a completed no-op rerun", async () => {
    const { port, draftReview } = mockPort();
    const entered = deferred();
    const release = deferred();
    draftReview.mockImplementation(async (input) => {
      entered.resolve();
      await release.promise;
      return { ok: true, value: success(input) };
    });
    const first = startDraftRun(db, "i", ["legal", "legal"], port, options);
    await entered.promise;
    let concurrent;
    try {
      concurrent = await startDraftRun(db, "i", ["legal"], port, options);
      expect(await tokensUsed()).toBe(1_500);
    } finally {
      release.resolve();
    }
    expect((await first).outcomes).toEqual([{ domain: "legal", status: "drafted" }]);
    expect(concurrent?.outcomes).toEqual([{ domain: "legal", status: "skipped", reason: "already running" }]);
    expect((await startDraftRun(db, "i", ["legal"], port, options)).outcomes).toEqual([{ domain: "legal", status: "skipped" }]);
    expect(draftReview).toHaveBeenCalledTimes(1);
    expect(await tokensUsed()).toBe(1_500);
    expect(await reservations()).toHaveLength(1);
  });

  it.each([
    { runtime: "openai", deep: "1", estimate: 1_500 },
    { runtime: "agents-sdk", deep: "0", estimate: 1_500 },
    { runtime: "agents-sdk", deep: "1", estimate: 15_000 },
  ])("reserves each retry before invocation with $runtime deep=$deep estimate=$estimate", async ({ runtime, deep, estimate }) => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder-never-sent");
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_DEEP_REVIEW", deep);
    const policy = draftBudgetPolicy(at);
    expect(policy).toEqual({ ...budget, tokensPerAttempt: estimate });
    const observed: number[] = [];
    const { port, draftReview } = mockPort();
    draftReview.mockImplementation(async (input) => {
      observed.push(await tokensUsed());
      return observed.length === 1
        ? { ok: false, error: { kind: "provider", message: "Transient synthetic provider failure", retryable: true } }
        : { ok: true, value: success(input) };
    });
    const result = await runReviewAgent(db, "cycle", "legal", reviewer, "workspace-a", port, { ...options, budget: policy, maxAttempts: 3 });
    expect(result.status).toBe("drafted");
    expect(draftReview).toHaveBeenCalledTimes(2);
    expect(observed).toEqual([estimate, estimate * 2]);
    const receipts = await reservations();
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((event) => event.metadata?.attemptId)).size).toBe(1);
    expect(receipts.map((event) => event.metadata?.attempt).sort()).toEqual([1, 2]);
    expect(receipts.every((event) => event.actor === reviewer.id && event.metadata?.estimatedTokens === estimate)).toBe(true);
  });

  it("does not invoke or reserve when the day is already exhausted", async () => {
    await db.insert(runBudget).values({ id: budget.day, day: budget.day, tokensUsed: budget.dailyCap, tokensCap: budget.dailyCap });
    const { port, draftReview } = mockPort();
    const result = await startDraftRun(db, "i", ["legal"], port, { ...options, maxAttempts: 3 });
    expect(result.outcomes[0]).toMatchObject({ status: "failed", error: { kind: "budget-exhausted" } });
    expect(draftReview).not.toHaveBeenCalled();
    expect(await tokensUsed()).toBe(budget.dailyCap);
    expect(await reservations()).toEqual([]);
  });

  it("stops retries when another reservation would exceed the cap", async () => {
    const { port, draftReview } = mockPort();
    draftReview.mockResolvedValue({ ok: false, error: { kind: "provider", message: "Transient", retryable: true } });
    const result = await startDraftRun(db, "i", ["legal"], port, { ...options, budget: { ...budget, dailyCap: 2_000 }, maxAttempts: 3 });
    expect(result.outcomes[0]).toMatchObject({ status: "failed", error: { kind: "budget-exhausted" } });
    expect(draftReview).toHaveBeenCalledTimes(1);
    expect(await tokensUsed()).toBe(1_500);
    expect(await reservations()).toHaveLength(1);
  });

  it("shares the atomic cap across concurrent domains", async () => {
    const { port, draftReview } = mockPort();
    const result = await startDraftRun(db, "i", ["legal", "security"], port, { ...options, budget: { ...budget, dailyCap: 1_500 }, concurrency: 2 });
    expect(result.outcomes.filter((outcome) => outcome.status === "drafted")).toHaveLength(1);
    expect(result.outcomes.filter((outcome) => outcome.error?.kind === "budget-exhausted")).toHaveLength(1);
    expect(draftReview).toHaveBeenCalledTimes(1);
    expect(await tokensUsed()).toBe(1_500);
    expect(await reservations()).toHaveLength(1);
  });

  const failures: PortFailure[] = [
    { kind: "validation", message: "Invalid input" },
    { kind: "cancelled", reason: "Cancelled" },
    { kind: "provider", message: "Permanent rejection", retryable: false },
    { kind: "budget-exhausted", message: "Provider budget exhausted" },
  ];
  it.each(failures)("does not retry a $kind failure or reserve unused retry capacity", async (failure) => {
    const { port, draftReview } = mockPort();
    draftReview.mockResolvedValue({ ok: false, error: failure });
    const result = await startDraftRun(db, "i", ["legal"], port, { ...options, maxAttempts: 3 });
    expect(result.outcomes[0]).toMatchObject({ status: "failed", error: failure });
    expect(draftReview).toHaveBeenCalledTimes(1);
    expect(await tokensUsed()).toBe(1_500);
    expect(await reservations()).toHaveLength(1);
  });
});
