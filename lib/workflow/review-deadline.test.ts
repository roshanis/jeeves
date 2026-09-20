import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { reviewDecisions, runBudget } from "../db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import * as service from "../services/initiative-service";
import { runSingleDomainDraft, startDraftRun } from "./review-run";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Hold one transaction at the same boundary where a database lock can wait. */
function blockTransaction(db: TestDb, transactionNumber: number) {
  const entered = deferred();
  const release = deferred();
  let count = 0;
  const blocked = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "transaction") {
        return async (callback: Parameters<TestDb["transaction"]>[0]) => {
          if (++count === transactionNumber) {
            entered.resolve();
            await release.promise;
          }
          return value.call(target, callback);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: blocked, entered, release };
}

describe("draft deadline across database waits", () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { vi.restoreAllMocks(); await closeTestDb(db); });

  async function fixture() {
    const requester = { id: "priya-raman", role: "requester" as const };
    const created = await service.createDraft(db, {
      payload: CHAMPION_PREFILL_PAYLOAD, requesterActor: requester, requesterName: "Priya Raman",
    });
    await service.submitIntake(db, created.initiativeId, requester);
    const triage = await service.triage(db, created.initiativeId);
    if (triage.branch !== "review") throw new Error("Review fixture required");
    return { cycleId: triage.cycleId, initiativeId: created.initiativeId };
  }

  it("does not launch a provider after reservation waits beyond the run deadline", async () => {
    const { cycleId } = await fixture();
    const blocked = blockTransaction(db, 2); // Claim, then reservation.
    const base = createMockAgentPort();
    const draftReview = vi.fn(base.draftReview);
    const clock = vi.spyOn(Date, "now");
    const start = Date.now();
    clock.mockReturnValue(start);
    const run = runSingleDomainDraft(blocked.db, cycleId, "legal", { ...base, draftReview }, {
      runTimeoutMs: 1000, attemptTimeoutMs: 1000, maxAttempts: 1,
      budget: { day: "2026-09-19", dailyCap: 5000, tokensPerAttempt: 1500 },
    });
    await blocked.entered.promise;
    // Advance only the application's elapsed clock while the query waits.
    // The database lease is still valid, so it cannot mask this deadline check.
    clock.mockReturnValue(start + 1001);
    blocked.release.resolve();
    const result = await run;
    expect(draftReview).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "failed" });
    expect(result.error).toMatch(/time limit|deadline/i);
    expect(await db.select().from(runBudget)).toHaveLength(0);
  });

  it("does not accept a successful response after final persistence waits beyond the deadline", async () => {
    const { cycleId } = await fixture();
    const blocked = blockTransaction(db, 3); // Claim, reservation, final save.
    const clock = vi.spyOn(Date, "now");
    const start = Date.now();
    clock.mockReturnValue(start);
    const run = runSingleDomainDraft(blocked.db, cycleId, "legal", createMockAgentPort(), {
      runTimeoutMs: 1000, attemptTimeoutMs: 1000, maxAttempts: 1,
    });
    await blocked.entered.promise;
    clock.mockReturnValue(start + 1001);
    blocked.release.resolve();
    const result = await run;
    expect(result).toMatchObject({ status: "failed" });
    expect(result.error).toMatch(/time limit|deadline/i);
    const [row] = await db.select().from(reviewDecisions).where(and(
      eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "legal"),
    ));
    expect(row).toMatchObject({ status: "pending", draftMd: null });
  });

  it("reports the final accepted timeout when a fan-out save outlasts the deadline", async () => {
    const { initiativeId } = await fixture();
    const blocked = blockTransaction(db, 3);
    const clock = vi.spyOn(Date, "now");
    const start = Date.now();
    clock.mockReturnValue(start);
    const run = startDraftRun(blocked.db, initiativeId, ["legal"], createMockAgentPort(), {
      runTimeoutMs: 1000, attemptTimeoutMs: 1000, maxAttempts: 1,
    });
    await blocked.entered.promise;
    clock.mockReturnValue(start + 1001);
    blocked.release.resolve();
    expect((await run).outcomes).toEqual([
      expect.objectContaining({ domain: "legal", status: "failed", error: expect.objectContaining({ kind: "timeout" }) }),
    ]);
  });

  it("does not launch a provider when cancelled during a database wait", async () => {
    const { cycleId } = await fixture();
    const blocked = blockTransaction(db, 2);
    const controller = new AbortController();
    const base = createMockAgentPort();
    const draftReview = vi.fn(base.draftReview);
    const run = runSingleDomainDraft(blocked.db, cycleId, "legal", { ...base, draftReview }, {
      signal: controller.signal, maxAttempts: 1,
      budget: { day: "2026-09-19", dailyCap: 5000, tokensPerAttempt: 1500 },
    });
    await blocked.entered.promise;
    controller.abort();
    blocked.release.resolve();
    expect(await run).toMatchObject({ status: "failed", error: "Draft generation was cancelled." });
    expect(draftReview).not.toHaveBeenCalled();
    expect(await db.select().from(runBudget)).toHaveLength(0);
  });
});
