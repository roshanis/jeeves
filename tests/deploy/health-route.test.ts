import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ execute: () => new Promise(() => {}) }),
}));

import { GET } from "@/app/api/health/route";

afterEach(() => vi.useRealTimers());

describe("GET /api/health", () => {
  it("answers 503 opaque when the database round-trip hangs", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = GET();
    await vi.advanceTimersByTimeAsync(2500);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", database: "unreachable" });
  });
});
