import { afterEach, describe, expect, it, vi } from "vitest";
import { markBootFailed, resetBootStateForTests } from "@/lib/config/boot-state";

let dbTouched = 0;
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    dbTouched += 1;
    throw new Error("database is down");
  },
}));

const { GET } = await import("./route");

afterEach(() => {
  resetBootStateForTests();
  dbTouched = 0;
});

describe("GET /api/health/live", () => {
  it("answers 200 while the database is down, without touching it", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "live" });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(dbTouched).toBe(0);
  });

  it("answers 503 once the boot has failed", async () => {
    markBootFailed("production configuration is invalid: secret detail");
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "boot_failed" });
    expect(text).not.toContain("secret detail");
  });
});
