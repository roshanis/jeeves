import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { runBudget, sessions } from "../db/schema";
import { reserve } from "../security/budget";
import {
  clientKeyFor,
  checkSessionAttempt,
  extractSessionToken,
  getBudgetStoreForTests,
  getRateLimiterForTests,
  issueDemoSession,
  resetGuardStateForTests,
  resolveSessionActor,
  runMutationGuard,
} from "./route-guard";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

function reqWithBearer(token: string, forwardedFor = "1.2.3.4"): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": forwardedFor },
  });
}

describe("lib/services/route-guard", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    resetGuardStateForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeTestDb(testDb);
  });

  it.each(["session", "mutation"])("exhausting %s allowance does not consume the other limiter", async (first) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-19T20:00:00Z"));
    const session = (await issueDemoSession("priya-raman"))!;
    const key = "independent-limiters";
    const sessionAttempt = async () => (await checkSessionAttempt(key)).allowed;
    const mutation = async () => (await runMutationGuard(reqWithBearer(session.token, key), undefined)).ok;
    const checks = first === "session"
      ? [[sessionAttempt, 5], [mutation, 20]] as const
      : [[mutation, 20], [sessionAttempt, 5]] as const;
    for (const [check, capacity] of checks) {
      for (let i = 0; i < capacity; i++) expect(await check()).toBe(true);
      expect(await check()).toBe(false);
    }
  });

  describe("issueDemoSession", () => {
    it("issues a session for a known persona without a password", async () => {
      const result = await issueDemoSession("priya-raman");
      expect(result).not.toBeNull();
      expect(result!.token).toHaveLength(64); // 32 bytes hex
      expect(result!.workspaceId).toBe(`ws_${result!.token}`);

      const [persisted] = await testDb.select().from(sessions).where(eq(sessions.token, result!.token));
      expect(persisted).toMatchObject({
        token: result!.token,
        personaKey: "priya-raman",
        workspaceId: result!.workspaceId,
        expiresAt: result!.expiresAt,
      });
    });

    it("rejects an unknown persona without creating a session", async () => {
      const result = await issueDemoSession("unknown-persona");
      expect(result).toBeNull();
    });

    it("returns null for an unknown persona key", async () => {
      const result = await issueDemoSession("not-a-real-persona");
      expect(result).toBeNull();
    });
  });

  describe("resolveSessionActor — role from session, never from body", () => {
    it("resolves the actor role from the persona bound at session issuance", async () => {
      const session = (await issueDemoSession("ray-chen"))!; // admin
      const actor = await resolveSessionActor(session.token);
      expect(actor).toEqual({ id: "ray-chen", role: "admin" });
    });

    it("returns null for an unknown/garbage token", async () => {
      expect(await resolveSessionActor("not-a-real-token")).toBeNull();
    });

    it("returns null for a missing token", async () => {
      expect(await resolveSessionActor(null)).toBeNull();
    });

    it("deletes an expired persisted session and returns null", async () => {
      const session = (await issueDemoSession("ray-chen"))!;
      await testDb.update(sessions).set({ expiresAt: Date.now() }).where(eq(sessions.token, session.token));

      expect(await resolveSessionActor(session.token)).toBeNull();
      expect(await testDb.select().from(sessions).where(eq(sessions.token, session.token))).toEqual([]);
    });
  });

  it("rejects a legacy session without a workspace before any mutation allowance is consumed", async () => {
    const issued = (await issueDemoSession("ray-chen"))!;
    // Current schema forbids null; emulate a legacy database only in this disposable test.
    await testDb.execute(sql`ALTER TABLE sessions ALTER COLUMN workspace_id DROP NOT NULL`);
    await testDb.execute(sql`UPDATE sessions SET workspace_id = NULL WHERE token = ${issued.token}`);
    const limiter = getRateLimiterForTests();
    const check = vi.spyOn(limiter, "checkAndConsume");
    const result = await runMutationGuard(reqWithBearer(issued.token), undefined, { requiresBudget: true, estimatedTokens: 100 });
    expect(result).toMatchObject({ ok: false, failure: { status: 401 } });
    expect(check).not.toHaveBeenCalled();
    expect(await testDb.select().from(runBudget)).toHaveLength(0);
  });

  describe("extractSessionToken", () => {
    it("reads a Bearer token from the Authorization header", () => {
      const req = reqWithBearer("abc123");
      expect(extractSessionToken(req)).toBe("abc123");
    });

    it("reads a token from the session cookie when no bearer header is present", () => {
      const req = new Request("http://localhost/api/x", {
        headers: { cookie: "other=1; jeeves_session=abc123; more=2" },
      });
      expect(extractSessionToken(req)).toBe("abc123");
    });

    it("returns null when neither is present", () => {
      const req = new Request("http://localhost/api/x");
      expect(extractSessionToken(req)).toBeNull();
    });
  });

  describe("clientKeyFor", () => {
    it("uses the first x-forwarded-for entry", () => {
      const req = new Request("http://localhost/api/x", {
        headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" },
      });
      expect(clientKeyFor(req)).toBe("9.9.9.9");
    });

    it("falls back to a constant key when absent", () => {
      const req = new Request("http://localhost/api/x");
      expect(clientKeyFor(req)).toBe("unknown-client");
    });
  });

  describe("runMutationGuard", () => {
    it("401s an unauthenticated request with no side effects (no rate-limit consumption)", async () => {
      const req = reqWithBearer("bogus-token", "5.5.5.5");
      const result = await runMutationGuard(req, undefined);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.failure.status).toBe(401);
    });

    it("200s (ok) with a valid session and resolves the actor from the session, not the body", async () => {
      const session = (await issueDemoSession("elena-vasquez"))!; // reviewer
      const req = reqWithBearer(session.token, "6.6.6.6");
      // Body claims 'admin' — must be ignored entirely; actor role must come from the session.
      const result = await runMutationGuard(req, { role: "admin" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.actor).toEqual({ id: "elena-vasquez", role: "reviewer" });
    });

    it("returns the session's workspaceId in the success result (M2.5 inc.2a)", async () => {
      const session = (await issueDemoSession("priya-raman"))!;
      const req = reqWithBearer(session.token, "6.6.6.7");
      const result = await runMutationGuard(req, undefined);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.workspaceId).toBe(session.workspaceId);
      expect(result.workspaceId).not.toBeNull();
    });

    it("429s after a burst exceeds the rate-limit capacity", async () => {
      const session = (await issueDemoSession("priya-raman"))!;
      const clientIp = "7.7.7.7";
      let lastResult: Awaited<ReturnType<typeof runMutationGuard>> | null = null;
      // capacity is 20 tokens; fire 25 requests from the same client key.
      for (let i = 0; i < 25; i++) {
        lastResult = await runMutationGuard(reqWithBearer(session.token, clientIp), undefined);
      }
      expect(lastResult!.ok).toBe(false);
      if (lastResult!.ok) throw new Error("unreachable");
      expect(lastResult!.failure.status).toBe(429);
      expect(lastResult!.failure.kind).toBe("rate_limited");
    });

    it("400s on input validation failure (field too long)", async () => {
      const session = (await issueDemoSession("priya-raman"))!;
      const req = reqWithBearer(session.token, "8.8.8.8");
      const result = await runMutationGuard(
        req,
        { title: "x".repeat(200) },
        { inputLimits: [{ field: "title", maxChars: 120 }] },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.failure.status).toBe(400);
      expect(result.failure.gaps?.[0]?.field).toBe("title");
    });

    it("429s when the daily token budget is exhausted", async () => {
      const session = (await issueDemoSession("priya-raman"))!;
      const req = reqWithBearer(session.token, "9.9.9.1");
      const result = await runMutationGuard(req, undefined, {
        requiresBudget: true,
        budgetDay: "2099-01-01",
        estimatedTokens: 10_000_000, // far exceeds the daily cap in one shot
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.failure.status).toBe(429);
      expect(result.failure.kind).toBe("budget_exhausted");
    });

    it("budget reserve costs 0 tokens for the mock adapter but still exercises the reserve path", async () => {
      const session = (await issueDemoSession("priya-raman"))!;
      const req = reqWithBearer(session.token, "9.9.9.2");
      const result = await runMutationGuard(req, undefined, {
        requiresBudget: true,
        budgetDay: "2099-01-02",
        estimatedTokens: 0,
      });
      expect(result.ok).toBe(true);
      expect(await testDb.select().from(runBudget).where(eq(runBudget.day, "2099-01-02"))).toHaveLength(1);
    });
  });

  describe("DB-backed budget store", () => {
    it("atomically grants only reservations that fit under the daily cap", async () => {
      const store = getBudgetStoreForTests();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => reserve(store, "2099-01-03", 100, 1_000)),
      );

      expect(results.filter((result) => result.granted)).toHaveLength(10);
      expect(await store.getUsed("2099-01-03")).toBe(1_000);
    });
  });
});
