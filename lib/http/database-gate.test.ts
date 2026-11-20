// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
let outsideRequestScope = false;
vi.mock("next/server", () => ({
  after: (p: Promise<unknown>) => {
    if (outsideRequestScope) throw new Error("after was called outside a request scope");
    after(p);
  },
}));

import {
  closeInstallationGate,
  resetBootStateForTests,
  setInstallationRecheck,
} from "../config/boot-state";
import { ApiError, apiErrorToMessage } from "../client/api";
import { consoleDatabaseReady, databaseNotReady, RETRY_AFTER_SECONDS } from "./database-gate";

beforeEach(() => {
  after.mockReset();
  outsideRequestScope = false;
});
afterEach(() => resetBootStateForTests());

describe("databaseNotReady", () => {
  it("is null while the gate is open", () => {
    expect(databaseNotReady()).toBeNull();
    expect(consoleDatabaseReady()).toBe(true);
  });

  it("answers 503 with Retry-After, no-store and a stable code while closed", async () => {
    closeInstallationGate();
    const res = databaseNotReady();
    expect(res?.status).toBe(503);
    expect(res?.headers.get("retry-after")).toBe(String(RETRY_AFTER_SECONDS));
    expect(res?.headers.get("retry-after")).toBe("15");
    expect(res?.headers.get("cache-control")).toMatch(/no-store/);
    const body = await res!.json();
    expect(body.code).toBe("DEMO_STORAGE_UNAVAILABLE");
    expect(typeof body.error).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/postgres|ECONN/i);
  });

  it("schedules the due recheck once, through after()", () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    closeInstallationGate();
    setInstallationRecheck(recheck, 0);
    databaseNotReady();
    databaseNotReady();
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("swallows after() throwing outside a request scope", () => {
    outsideRequestScope = true;
    closeInstallationGate();
    setInstallationRecheck(vi.fn().mockResolvedValue(undefined), 0);
    expect(() => databaseNotReady()).not.toThrow();
  });

  it("is null in the console check only while open", () => {
    closeInstallationGate();
    expect(consoleDatabaseReady()).toBe(false);
  });

  it("maps to the existing storage-unavailable copy on the client", () => {
    expect(apiErrorToMessage(new ApiError(503, "x", undefined, "DEMO_STORAGE_UNAVAILABLE"))).toMatch(/storage is temporarily unavailable/i);
  });
});
