// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_RECHECK_INTERVAL_MS,
  bootFailure,
  closeInstallationGate,
  installationGateClosed,
  markBootFailed,
  openInstallationGate,
  requestInstallationRecheck,
  resetBootStateForTests,
  setInstallationRecheck,
} from "./boot-state";

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

describe("installation gate", () => {
  it("is open by default", () => {
    expect(installationGateClosed()).toBe(false);
    expect(requestInstallationRecheck()).toBeNull();
  });

  it("closes, opens, and is cleared by the test reset", () => {
    closeInstallationGate();
    expect(installationGateClosed()).toBe(true);
    openInstallationGate();
    expect(installationGateClosed()).toBe(false);
    closeInstallationGate();
    resetBootStateForTests();
    expect(installationGateClosed()).toBe(false);
  });

  it("starts no recheck when none is registered", () => {
    closeInstallationGate();
    expect(requestInstallationRecheck(1_000_000)).toBeNull();
  });

  it("starts no recheck while the gate is open", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    setInstallationRecheck(fn, 0);
    expect(requestInstallationRecheck(DEMO_RECHECK_INTERVAL_MS * 10)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("waits the interval after the last attempt", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    closeInstallationGate();
    setInstallationRecheck(fn, 100_000);
    expect(requestInstallationRecheck(100_000 + DEMO_RECHECK_INTERVAL_MS - 1)).toBeNull();
    const started = requestInstallationRecheck(100_000 + DEMO_RECHECK_INTERVAL_MS);
    expect(started).not.toBeNull();
    await started;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs one recheck at a time", async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    closeInstallationGate();
    setInstallationRecheck(fn, 0);
    const first = requestInstallationRecheck(DEMO_RECHECK_INTERVAL_MS);
    expect(requestInstallationRecheck(DEMO_RECHECK_INTERVAL_MS * 3)).toBeNull();
    release();
    await first;
    expect(requestInstallationRecheck(DEMO_RECHECK_INTERVAL_MS * 3)).not.toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not reject when the recheck rejects", async () => {
    closeInstallationGate();
    setInstallationRecheck(() => Promise.reject(new Error("boom")), 0);
    await expect(requestInstallationRecheck(DEMO_RECHECK_INTERVAL_MS)).resolves.toBeUndefined();
  });

  it("is shared across separately loaded copies of the module", async () => {
    closeInstallationGate();
    vi.resetModules();
    const other = await import("./boot-state");
    expect(other.installationGateClosed()).toBe(true);
  });
});
