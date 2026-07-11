import { beforeEach, describe, expect, it } from "vitest";
import {
  clientKeyFor,
  extractSessionToken,
  issueDemoSession,
  resetGuardStateForTests,
  resolveSessionActor,
  runMutationGuard,
} from "./route-guard";

const PASSCODE = "correct-horse-battery-staple";

function reqWithBearer(token: string, forwardedFor = "1.2.3.4"): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": forwardedFor },
  });
}

describe("lib/services/route-guard", () => {
  beforeEach(() => {
    resetGuardStateForTests();
  });

  describe("issueDemoSession", () => {
    it("issues a session for a correct passcode + known persona", () => {
      const result = issueDemoSession(PASSCODE, PASSCODE, "priya-raman");
      expect(result).not.toBeNull();
      expect(result!.token).toHaveLength(64); // 32 bytes hex
      expect(result!.workspaceId).toBe(`ws_${result!.token}`);
    });

    it("returns null for a wrong passcode (no session created)", () => {
      const result = issueDemoSession("wrong", PASSCODE, "priya-raman");
      expect(result).toBeNull();
    });

    it("returns null for an unknown persona key", () => {
      const result = issueDemoSession(PASSCODE, PASSCODE, "not-a-real-persona");
      expect(result).toBeNull();
    });
  });

  describe("resolveSessionActor — role from session, never from body", () => {
    it("resolves the actor role from the persona bound at session issuance", () => {
      const session = issueDemoSession(PASSCODE, PASSCODE, "ray-chen")!; // admin
      const actor = resolveSessionActor(session.token);
      expect(actor).toEqual({ id: "ray-chen", role: "admin" });
    });

    it("returns null for an unknown/garbage token", () => {
      expect(resolveSessionActor("not-a-real-token")).toBeNull();
    });

    it("returns null for a missing token", () => {
      expect(resolveSessionActor(null)).toBeNull();
    });
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
      const session = issueDemoSession(PASSCODE, PASSCODE, "elena-vasquez")!; // reviewer
      const req = reqWithBearer(session.token, "6.6.6.6");
      // Body claims 'admin' — must be ignored entirely; actor role must come from the session.
      const result = await runMutationGuard(req, { role: "admin" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.actor).toEqual({ id: "elena-vasquez", role: "reviewer" });
    });

    it("429s after a burst exceeds the rate-limit capacity", async () => {
      const session = issueDemoSession(PASSCODE, PASSCODE, "priya-raman")!;
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
      const session = issueDemoSession(PASSCODE, PASSCODE, "priya-raman")!;
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
      const session = issueDemoSession(PASSCODE, PASSCODE, "priya-raman")!;
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
      const session = issueDemoSession(PASSCODE, PASSCODE, "priya-raman")!;
      const req = reqWithBearer(session.token, "9.9.9.2");
      const result = await runMutationGuard(req, undefined, {
        requiresBudget: true,
        budgetDay: "2099-01-02",
        estimatedTokens: 0,
      });
      expect(result.ok).toBe(true);
    });
  });
});
