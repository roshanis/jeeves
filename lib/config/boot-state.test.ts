// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootFailure, markBootFailed, resetBootStateForTests } from "./boot-state";

afterEach(() => {
  resetBootStateForTests();
});

describe("boot state", () => {
  it("reports no failure by default", () => {
    expect(bootFailure()).toBeNull();
  });

  it("records the failure reason once boot has failed", () => {
    markBootFailed("production configuration is invalid");
    expect(bootFailure()).toBe("production configuration is invalid");
  });

  // Fail-closed means the flag only ever goes one way. A second, later
  // failure must not overwrite the first, and nothing but the test helper
  // clears it.
  it("keeps the first reason when marked again", () => {
    markBootFailed("first");
    markBootFailed("second");
    expect(bootFailure()).toBe("first");
  });

  it("still reads as failed when the reason is blank", () => {
    markBootFailed("");
    expect(bootFailure()).not.toBeNull();
  });

  // Next.js evaluates instrumentation.ts and the route handlers in separate
  // module graphs, so the flag lives on globalThis like the DB handle does.
  // A module-level variable would let a failed register() go unseen by
  // /api/health.
  it("is shared across separately loaded copies of the module", async () => {
    markBootFailed("seen everywhere");
    vi.resetModules();
    const other = await import("./boot-state");
    expect(other.bootFailure()).toBe("seen everywhere");
  });
});
