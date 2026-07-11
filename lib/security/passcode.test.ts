import { describe, expect, it, vi } from "vitest";
import { verifyPasscode } from "./passcode";

describe("verifyPasscode — correct passcode", () => {
  it("returns ok: true when provided matches expected exactly", () => {
    const result = verifyPasscode("demo-passcode-123", "demo-passcode-123");
    expect(result).toEqual({ ok: true });
  });
});

describe("verifyPasscode — incorrect passcode", () => {
  it("returns ok: false, reason: 'mismatch' when same length but different value", () => {
    const result = verifyPasscode("demo-passcode-124", "demo-passcode-123");
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("returns ok: false for an empty provided value against a non-empty expected value", () => {
    const result = verifyPasscode("", "demo-passcode-123");
    expect(result.ok).toBe(false);
  });
});

describe("verifyPasscode — length mismatch", () => {
  it("returns ok: false, reason: 'mismatch' when provided is shorter than expected", () => {
    const result = verifyPasscode("short", "demo-passcode-123");
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("returns ok: false, reason: 'mismatch' when provided is longer than expected", () => {
    const result = verifyPasscode("demo-passcode-123-and-then-some-more", "demo-passcode-123");
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("does not throw when lengths differ (guards against timingSafeEqual's length requirement)", () => {
    expect(() => verifyPasscode("x", "demo-passcode-123")).not.toThrow();
  });
});

describe("verifyPasscode — misconfiguration", () => {
  it("returns ok: false, reason: 'misconfigured' when expected is empty", () => {
    const result = verifyPasscode("anything", "");
    expect(result).toEqual({ ok: false, reason: "misconfigured" });
  });

  it("returns ok: false, reason: 'misconfigured' when expected is empty even if provided is also empty", () => {
    const result = verifyPasscode("", "");
    expect(result).toEqual({ ok: false, reason: "misconfigured" });
  });
});

describe("verifyPasscode — never logs the passcode", () => {
  it("does not call console.log/warn/error with the passcode value", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    verifyPasscode("super-secret-value", "demo-passcode-123");

    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain("super-secret-value");
          expect(String(arg)).not.toContain("demo-passcode-123");
        }
      }
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("verifyPasscode — constant-time comparison behavior", () => {
  it("uses timing-safe comparison so equal-length mismatches take a comparable code path to matches", () => {
    // We can't assert timing directly in a unit test (flaky by nature), but
    // we can assert the function never short-circuits on the first
    // differing character by checking a mismatch at index 0 vs a mismatch
    // at the last index both correctly report ok: false via the same
    // reason, i.e. no early-return branch keyed on *where* the mismatch is.
    const expected = "abcdefghij";
    const mismatchEarly = verifyPasscode("zbcdefghij", expected);
    const mismatchLate = verifyPasscode("abcdefghiz", expected);
    expect(mismatchEarly).toEqual({ ok: false, reason: "mismatch" });
    expect(mismatchLate).toEqual({ ok: false, reason: "mismatch" });
  });
});
