import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { runBudget, sessions } from "../db/schema";
import { reserve } from "../security/budget";
import { DbTokenBucketRateLimiter } from "../security/db-rate-limit";
import {
  clientKeyFor,
  checkSessionAttempt,
  extractSessionToken,
  getBudgetStoreForTests,
  issueDemoSession,
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

// Pure header parsing: kept outside the DB-backed describe above so these do
// not each pay for a fresh PGlite instance.
describe("clientKeyFor — JEEVES_TRUSTED_PROXY_HOPS", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const withXff = (value: string | null): Request =>
    new Request("http://localhost/api/x", value === null ? {} : { headers: { "x-forwarded-for": value } });

  // Vercel overwrites the header, so the leftmost entry is the client.
  // That default must not change: it is what the live demo runs on.
  it.each([undefined, "", "   ", "0", " 0 ", "00"])(
    "keeps the leftmost entry (today's behaviour) when set to %j",
    (value) => {
      if (value !== undefined) vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", value);
      expect(clientKeyFor(withXff("9.9.9.9, 1.1.1.1, 2.2.2.2"))).toBe("9.9.9.9");
    },
  );

  it("with 1 hop (ALB) takes the rightmost entry, which the ALB appended", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "1");
    expect(clientKeyFor(withXff("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("with 1 hop ignores spoofed entries to the left of the one the proxy appended", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "1");
    // The attacker sent "X-Forwarded-For: 10.0.0.1, 10.0.0.2"; the ALB
    // appended the address it actually saw.
    expect(clientKeyFor(withXff("10.0.0.1, 10.0.0.2, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("rotating a spoofed left entry does not change the key", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "1");
    const a = clientKeyFor(withXff("1.1.1.1, 203.0.113.9"));
    const b = clientKeyFor(withXff("2.2.2.2, 203.0.113.9"));
    expect(a).toBe(b);
  });

  it("with 2 hops (CloudFront then ALB) skips the edge address and takes the viewer", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "2");
    // spoofed, viewer (appended by CloudFront), edge (appended by the ALB)
    expect(clientKeyFor(withXff("6.6.6.6, 198.51.100.7, 130.176.0.1"))).toBe("198.51.100.7");
  });

  it("tolerates whitespace around the setting and the entries", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", " 1 ");
    expect(clientKeyFor(withXff("  6.6.6.6 ,   203.0.113.9  "))).toBe("203.0.113.9");
  });

  it("falls back to the constant key when the header is absent", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "1");
    expect(clientKeyFor(withXff(null))).toBe("unknown-client");
  });

  it("does not trust a shorter chain than configured (a request that skipped a proxy)", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "2");
    // One entry cannot have passed through two trusted proxies, so it is
    // whatever the caller typed. Never use it.
    expect(clientKeyFor(withXff("6.6.6.6"))).toBe("unknown-client");
  });

  it("falls back to the constant key when the selected entry is empty", () => {
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "1");
    expect(clientKeyFor(withXff("1.1.1.1,,"))).toBe("unknown-client");
  });

  // A malformed value must not silently degrade to "trust the leftmost
  // entry" - that would reopen the spoofing hole on exactly the install
  // that tried to close it. Fail closed: one shared bucket, loud log.
  it.each(["abc", "-1", "1.5", "1e2", "0x1", "+1", "NaN", "Infinity", "one", "1,2", "99999999999999999999"])(
    "treats malformed value %j as misconfiguration: ignores the header and warns",
    (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", value);
      expect(clientKeyFor(withXff("6.6.6.6, 203.0.113.9"))).toBe("unknown-client");
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]![0])).toContain("JEEVES_TRUSTED_PROXY_HOPS");
    },
  );

  it("warns once per malformed value, not on every request", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("JEEVES_TRUSTED_PROXY_HOPS", "not-a-number-once");
    clientKeyFor(withXff("1.1.1.1"));
    clientKeyFor(withXff("1.1.1.1"));
    clientKeyFor(withXff("1.1.1.1"));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
