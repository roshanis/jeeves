import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveWorkspaceCookieSecret,
  signWorkspaceId,
  verifyWorkspaceCookie,
} from "./workspace-cookie";

const ORIGINAL_ENV = { ...process.env };

describe("lib/security/workspace-cookie", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("signWorkspaceId / verifyWorkspaceCookie round-trip", () => {
    it("verifies a value it signed itself", () => {
      const signed = signWorkspaceId("ws_abc123def456", "top-secret");
      expect(signed).toMatch(/^ws_abc123def456\.[0-9a-f]{64}$/);
      expect(verifyWorkspaceCookie(signed, "top-secret")).toBe("ws_abc123def456");
    });

    it("verifies a real-shaped workspace id (ws_ + 64 hex chars, 67 total)", () => {
      const id = `ws_${"a1".repeat(32)}`; // 3 + 64 = 67 chars
      const signed = signWorkspaceId(id, "s3cret");
      expect(verifyWorkspaceCookie(signed, "s3cret")).toBe(id);
    });
  });

  describe("tampering / wrong secret / malformed input -> null", () => {
    it("rejects a tampered id with a still-valid-looking mac", () => {
      const signed = signWorkspaceId("ws_abc123def456", "top-secret");
      const [, mac] = signed.split(".");
      const tampered = `ws_evil-workspace.${mac}`;
      expect(verifyWorkspaceCookie(tampered, "top-secret")).toBeNull();
    });

    it("rejects a tampered mac", () => {
      const signed = signWorkspaceId("ws_abc123def456", "top-secret");
      const tampered = signed.slice(0, -1) + (signed.endsWith("0") ? "1" : "0");
      expect(verifyWorkspaceCookie(tampered, "top-secret")).toBeNull();
    });

    it("rejects a value signed with a different secret", () => {
      const signed = signWorkspaceId("ws_abc123def456", "secret-a");
      expect(verifyWorkspaceCookie(signed, "secret-b")).toBeNull();
    });

    it("rejects a legacy/unsigned raw workspace id (no '.<mac>' suffix)", () => {
      expect(verifyWorkspaceCookie("ws_abc123def456", "top-secret")).toBeNull();
    });

    it("rejects an empty/missing value", () => {
      expect(verifyWorkspaceCookie("", "top-secret")).toBeNull();
      expect(verifyWorkspaceCookie(null, "top-secret")).toBeNull();
      expect(verifyWorkspaceCookie(undefined, "top-secret")).toBeNull();
    });

    it("rejects an id that fails the safe-id-format check even with a correct mac", () => {
      // Signing something outside the allowed id shape, then verifying against
      // the same secret still fails the format check before the mac is trusted.
      const signed = signWorkspaceId("not a safe id!!", "top-secret");
      expect(verifyWorkspaceCookie(signed, "top-secret")).toBeNull();
    });

    it("rejects when no secret is available (never trust/reuse without one)", () => {
      const signed = signWorkspaceId("ws_abc123def456", "top-secret");
      expect(verifyWorkspaceCookie(signed, null)).toBeNull();
    });
  });

  describe("resolveWorkspaceCookieSecret", () => {
    beforeEach(() => {
      delete process.env.JEEVES_COOKIE_SECRET;
      delete process.env.DEMO_PASSCODE;
    });

    it("prefers JEEVES_COOKIE_SECRET when set", () => {
      process.env.JEEVES_COOKIE_SECRET = "explicit-secret";
      process.env.DEMO_PASSCODE = "some-passcode";
      expect(resolveWorkspaceCookieSecret()).toBe("explicit-secret");
    });

    it("derives a secret from DEMO_PASSCODE when JEEVES_COOKIE_SECRET is unset", () => {
      process.env.DEMO_PASSCODE = "some-passcode";
      const derived = resolveWorkspaceCookieSecret();
      expect(derived).toBeTruthy();
      expect(derived).not.toBe("some-passcode"); // never reuse the raw passcode bytes directly
    });

    it("derives the SAME secret from the same DEMO_PASSCODE (deterministic)", () => {
      process.env.DEMO_PASSCODE = "some-passcode";
      const a = resolveWorkspaceCookieSecret();
      const b = resolveWorkspaceCookieSecret();
      expect(a).toBe(b);
    });

    it("returns null when neither env var is set — callers must never reuse", () => {
      expect(resolveWorkspaceCookieSecret()).toBeNull();
    });

    it("returns null for an empty-string DEMO_PASSCODE (misconfigured, not a valid secret source)", () => {
      process.env.DEMO_PASSCODE = "";
      expect(resolveWorkspaceCookieSecret()).toBeNull();
    });
  });
});
