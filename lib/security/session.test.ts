import { describe, expect, it } from "vitest";
import { issueSession, validateSession, deriveWorkspaceId } from "./session";

function fakeClock(startMs: number) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("issueSession — token generation", () => {
  it("issues a session with a non-empty opaque token id", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(typeof session.token).toBe("string");
    expect(session.token.length).toBeGreaterThan(0);
  });

  it("issues distinct tokens across calls (no collisions in practice)", () => {
    const clock = fakeClock(0);
    const a = issueSession({ ttlMs: 60_000 }, clock.now);
    const b = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(a.token).not.toBe(b.token);
  });

  it("records the expiry as now + ttlMs", () => {
    const clock = fakeClock(1_000_000);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(session.expiresAt).toBe(1_000_000 + 60_000);
  });

  it("assigns a workspace id to the issued session", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(typeof session.workspaceId).toBe("string");
    expect(session.workspaceId.length).toBeGreaterThan(0);
  });
});

describe("validateSession — valid, unexpired session", () => {
  it("returns valid: true before the TTL elapses", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    clock.advance(30_000);
    const result = validateSession(session, clock.now);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid: true at exactly the moment of issuance", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    const result = validateSession(session, clock.now);
    expect(result.valid).toBe(true);
  });
});

describe("validateSession — expiry with injected clock", () => {
  it("returns valid: false, reason: 'expired' once now() passes expiresAt", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    clock.advance(60_001);
    const result = validateSession(session, clock.now);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("treats now() === expiresAt as expired (TTL is exclusive)", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    clock.advance(60_000);
    const result = validateSession(session, clock.now);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });
});

describe("deriveWorkspaceId — data namespacing", () => {
  it("derives the same workspace id from the same session token deterministically", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(deriveWorkspaceId(session.token)).toBe(deriveWorkspaceId(session.token));
  });

  it("derives different workspace ids for different session tokens", () => {
    const clock = fakeClock(0);
    const a = issueSession({ ttlMs: 60_000 }, clock.now);
    const b = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(deriveWorkspaceId(a.token)).not.toBe(deriveWorkspaceId(b.token));
  });

  it("matches the workspaceId assigned at issuance", () => {
    const clock = fakeClock(0);
    const session = issueSession({ ttlMs: 60_000 }, clock.now);
    expect(deriveWorkspaceId(session.token)).toBe(session.workspaceId);
  });
});
