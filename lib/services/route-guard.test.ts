import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { rateLimitBuckets, runBudget, sessions } from "../db/schema";
import { reserve } from "../security/budget";
import { DbTokenBucketRateLimiter } from "../security/db-rate-limit";
import {
  clientKeyFor,
  checkSessionAttempt,
  extractSessionToken,
  getBudgetStoreForTests,
  issueDemoSession,
  issuePublicSession,
  pruneStaleState,
  resetHousekeepingCounterForTests,
  resolveSession,
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeTestDb(testDb);
  });

  it.each([
    ["db", ""],
    [undefined, "postgresql://unused.invalid/injected-test-db"],
  ] as const)("keeps provider %s interactive with database %s", async (mode, databaseUrl) => {
    vi.stubEnv("DATA_PROVIDER", mode);
    vi.stubEnv("DATABASE_URL", databaseUrl);
    const session = await issueDemoSession("priya-raman");
    expect(session).not.toBeNull();
    expect(await runMutationGuard(reqWithBearer(session!.token), undefined)).toMatchObject({ ok: true });
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
      expect(result!.workspaceId).toMatch(/^ws_[0-9a-f]{64}$/);
      expect(result!.workspaceId).not.toContain(result!.token);
      expect(result!.expiresInMs).toBe(60 * 60 * 1000);

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
    const check = vi.spyOn(DbTokenBucketRateLimiter.prototype, "checkAndConsume");
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

    it("treats a malformed percent-encoded session cookie as no session", () => {
      const req = new Request("http://localhost/api/x", {
        headers: { cookie: "jeeves_session=%E0%A4%A" },
      });
      expect(extractSessionToken(req)).toBeNull();
    });

    it("matches the Bearer scheme case-insensitively", () => {
      const req = new Request("http://localhost/api/x", {
        headers: { authorization: "bearer tok" },
      });
      expect(extractSessionToken(req)).toBe("tok");
    });
  });

  describe("resolveSession database failure", () => {
    it("rethrows an error that does not carry the presented token or bound parameters", async () => {
      await testDb.execute(sql`drop table sessions cascade`);
      const token = "SECRET-TOKEN-abc123";
      const err = await resolveSession(token).then(
        () => null,
        (e: unknown) => e as Error & { code?: string },
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).not.toContain(token);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(token);
      expect(err!.code).toBe("42P01");
    });
  });

  describe("session insert database failure", () => {
    async function failureOf(issue: () => Promise<unknown>): Promise<Error & { code?: string }> {
      await testDb.execute(sql`drop table sessions cascade`);
      const err = await issue().then(
        () => null,
        (e: unknown) => e as Error & { code?: string },
      );
      expect(err).toBeInstanceOf(Error);
      return err!;
    }

    // The insert binds the new session token as a parameter; a raw driver
    // error would quote it. A redacted error carries no statement or params.
    function expectRedacted(err: Error & { code?: string }): void {
      expect(err.message).toBe("Database query failed (SQLSTATE 42P01)");
      expect("params" in err).toBe(false);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toMatch(/[0-9a-f]{32}/i);
      expect(err.code).toBe("42P01");
    }

    it("redacts a failed demo session insert", async () => {
      expectRedacted(await failureOf(() => issueDemoSession("elena-vasquez")));
    });

    it("redacts a failed public session insert", async () => {
      expectRedacted(await failureOf(() => issuePublicSession("7.7.7.7")));
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
      expect(result.failure.message).toBe("daily model budget reached");
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

describe("client addresses in rate-limit buckets", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    vi.stubEnv("JEEVES_COOKIE_SECRET", "rate-limit-key-test-secret");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeTestDb(testDb);
  });

  it("does not store the client address in clear in any bucket key", async () => {
    await issuePublicSession("10.0.0.1");
    await checkSessionAttempt("10.0.0.1");
    await checkSessionAttempt("10.0.0.1", true);
    const session = (await issueDemoSession("priya-raman"))!;
    await runMutationGuard(reqWithBearer(session.token, "10.0.0.1"), undefined);
    const keys = (await testDb.select().from(rateLimitBuckets)).map((row) => row.key);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) expect(key).not.toContain("10.0.0.1");
    expect(keys.some((key) => key.startsWith("public-session:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("mutation:"))).toBe(true);
  });

  it("keys the same client to the same bucket, so limits still apply", async () => {
    const first = await checkSessionAttempt("10.0.0.2");
    for (let i = 0; i < 5; i++) await checkSessionAttempt("10.0.0.2");
    expect(first.allowed).toBe(true);
    expect((await checkSessionAttempt("10.0.0.2")).allowed).toBe(false);
    expect((await checkSessionAttempt("10.0.0.3")).allowed).toBe(true);
  });

  it("prunes stale clear-text buckets left by earlier versions, and expired sessions, but not fresh rows", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await testDb.insert(rateLimitBuckets).values([
      { key: "session:10.0.0.9", tokens: 4, lastRefillMs: now - day, lastTouchedMs: now - day },
      { key: "session:10.0.0.10", tokens: 0, lastRefillMs: now, lastTouchedMs: now },
    ]);
    await testDb.insert(sessions).values([
      { token: "expired-token", personaKey: "priya-raman", workspaceId: "w1", expiresAt: now - 1000 },
      { token: "live-token", personaKey: "priya-raman", workspaceId: "w2", expiresAt: now + 60_000 },
    ]);
    await pruneStaleState();
    expect((await testDb.select().from(rateLimitBuckets)).map((row) => row.key)).toEqual(["session:10.0.0.10"]);
    expect((await testDb.select().from(sessions)).map((row) => row.token)).toEqual(["live-token"]);
  });

  it("prunes on the first guarded call of a process and then on every 100th", async () => {
    resetHousekeepingCounterForTests();
    const now = Date.now();
    const insertStale = (key: string) =>
      testDb.insert(rateLimitBuckets).values({ key, tokens: 5, lastRefillMs: now - 86_400_000, lastTouchedMs: now - 86_400_000 });
    const has = async (key: string) => (await testDb.select().from(rateLimitBuckets)).map((row) => row.key).includes(key);
    await insertStale("session:10.0.0.11");
    await checkSessionAttempt("10.2.2.2");
    expect(await has("session:10.0.0.11")).toBe(false);
    await insertStale("session:10.0.0.12");
    for (let i = 0; i < 99; i++) await checkSessionAttempt(`10.2.0.${i}`);
    expect(await has("session:10.0.0.12")).toBe(true);
    await checkSessionAttempt("10.2.1.1");
    expect(await has("session:10.0.0.12")).toBe(false);
  });

  it("does not fail the request when housekeeping fails, and logs once", async () => {
    resetHousekeepingCounterForTests();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(testDb, "execute").mockRejectedValueOnce(new Error("boom"));
    await expect(checkSessionAttempt("10.3.1.1")).resolves.toMatchObject({ allowed: true });
    expect(log.mock.calls.filter((call) => call[0] === "Housekeeping failed")).toHaveLength(1);
  });

  it("a test can park the counter mid-cycle", async () => {
    resetHousekeepingCounterForTests(1);
    const now = Date.now();
    await testDb.insert(rateLimitBuckets).values({ key: "session:10.0.0.13", tokens: 5, lastRefillMs: now - 86_400_000, lastTouchedMs: now - 86_400_000 });
    await checkSessionAttempt("10.5.0.1");
    expect((await testDb.select().from(rateLimitBuckets)).map((row) => row.key)).toContain("session:10.0.0.13");
  });

  it("never calls Math.random on the request path", async () => {
    const random = vi.spyOn(Math, "random");
    const session = (await issueDemoSession("priya-raman"))!;
    random.mockClear();
    await runMutationGuard(reqWithBearer(session.token, "10.4.0.1"), undefined);
    await checkSessionAttempt("10.4.0.2");
    await issuePublicSession("10.4.0.3");
    expect(random).not.toHaveBeenCalled();
  });
});

describe("public role is denied by default", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(testDb);
  });

  it("answers 403 to a public session without allowPublic and passes with it", async () => {
    const issued = await issuePublicSession("10.1.0.1");
    if (!("token" in issued)) throw new Error("expected a public session");
    const denied = await runMutationGuard(reqWithBearer(issued.token, "10.1.0.2"), undefined);
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("unreachable");
    expect(denied.failure.status).toBe(403);
    const allowed = await runMutationGuard(reqWithBearer(issued.token, "10.1.0.3"), undefined, { allowPublic: true });
    expect(allowed).toMatchObject({ ok: true, actor: { role: "public" } });
  });
});
