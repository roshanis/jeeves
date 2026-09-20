import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, reviewDecisions } from "../db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import type { AgentPort } from "../agents/ports";
import * as service from "../services/initiative-service";
import { startDraftRun } from "./review-run";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("review reliability contracts", () => {
  let db: TestDb;
  const requester = { id: "priya-raman", role: "requester" as const };
  const reviewer = { id: "james-liu", role: "reviewer" as const };
  const base = createMockAgentPort();
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await closeTestDb(db); });

  async function setup() {
    const draft = await service.createDraft(db, { payload: CHAMPION_PREFILL_PAYLOAD, requesterActor: requester, requesterName: "Priya Raman" });
    await service.submitIntake(db, draft.initiativeId, requester);
    const triage = await service.triage(db, draft.initiativeId);
    if (triage.branch !== "review") throw new Error("review fixture required");
    return { initiativeId: draft.initiativeId, cycleId: triage.cycleId };
  }

  async function row(cycleId: string) {
    return (await db.select().from(reviewDecisions).where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "legal"))))[0]!;
  }

  it("claims concurrent and duplicate domain work once", async () => {
    const fixture = await setup();
    const entered = deferred(); const release = deferred(); let calls = 0;
    const port: AgentPort = { ...base, async draftReview(input) {
      calls += 1;
      if (calls === 1) { entered.resolve(); await release.promise; }
      return base.draftReview(input);
    } };
    const first = startDraftRun(db, fixture.initiativeId, ["legal", "legal"], port);
    await entered.promise;
    const second = await startDraftRun(db, fixture.initiativeId, ["legal"], port);
    release.resolve(); await first;
    expect(calls).toBe(1);
    expect(second.outcomes).toEqual([{ domain: "legal", status: "skipped", reason: "already running" }]);
  });

  it("preserves a human return and reason when an old draft completes", async () => {
    const fixture = await setup(); const entered = deferred(); const release = deferred();
    const port: AgentPort = { ...base, async draftReview(input) { entered.resolve(); await release.promise; return base.draftReview(input); } };
    const pending = startDraftRun(db, fixture.initiativeId, ["legal"], port);
    await entered.promise;
    await service.returnReview(db, fixture.cycleId, "legal", reviewer, null, "Provide the corrected evidence", 0);
    release.resolve(); const result = await pending;
    expect(await row(fixture.cycleId)).toMatchObject({ status: "returned", returnReason: "Provide the corrected evidence" });
    expect(result.outcomes[0]).toMatchObject({ status: "skipped", reason: "superseded" });
  });

  it("stores policy references separately from evidence gaps", async () => {
    const fixture = await setup();
    const port: AgentPort = { ...base, async draftReview(input) {
      const result = await base.draftReview(input);
      if (!result.ok) return result;
      return { ok: true, value: { ...result.value, citations: ["POLICY-A §1"], missingEvidence: ["Provide DPIA"], evidenceRequests: [{ controlId: "H-01", description: "Provide DPIA" }] } };
    } };
    await startDraftRun(db, fixture.initiativeId, ["legal"], port);
    expect(await row(fixture.cycleId)).toMatchObject({ citations: ["POLICY-A §1"], missingEvidence: ["Provide DPIA"], citationProvenance: "agent-supplied" });
  });

  it("bounds a stalled provider and refuses its late result", async () => {
    const fixture = await setup(); const release = deferred();
    const port: AgentPort = { ...base, async draftReview(input) { await release.promise; return base.draftReview(input); } };
    const pending = startDraftRun(db, fixture.initiativeId, ["legal"], port, { maxAttempts: 1, attemptTimeoutMs: 10, runTimeoutMs: 100, retryDelayMs: 0 });
    const result = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]);
    release.resolve(); await pending;
    expect(result?.outcomes[0]).toMatchObject({ status: "failed", error: { kind: "timeout" } });
    expect((await row(fixture.cycleId)).status).toBe("pending");
  });

  it("rolls back the accepted draft if its actor receipt cannot be saved", async () => {
    const fixture = await setup();
    const before = await row(fixture.cycleId);
    const failure = new Error("controlled audit failure");
    function intercept<T extends object>(target: T): T {
      return new Proxy(target, { get(object, key) {
        const value: unknown = Reflect.get(object, key, object);
        if (typeof value !== "function") return value;
        if (key === "transaction") return (callback: (tx: object) => unknown) => Reflect.apply(value, object, [(tx: object) => callback(intercept(tx))]);
        if (key === "insert") return (table: unknown) => {
          const insert = Reflect.apply(value, object, [table]);
          if (table !== auditEvents) return insert;
          return new Proxy(insert, { get(query, method) {
            if (method === "values") return (data: {action?: string}) => {
              if (data.action === "review_agent_run") throw failure;
              return query.values(data);
            };
            const fn = Reflect.get(query, method, query);
            return typeof fn === "function" ? fn.bind(query) : fn;
          } });
        };
        return typeof value === "function" ? value.bind(object) : value;
      } });
    }
    await expect(service.runReviewAgent(intercept(db), fixture.cycleId, "legal", reviewer, null, base)).rejects.toThrow("controlled audit failure");
    const after = await row(fixture.cycleId);
    expect(after.draftMd).toBe(before.draftMd);
    expect(after.status).toBe(before.status);
  });
});
