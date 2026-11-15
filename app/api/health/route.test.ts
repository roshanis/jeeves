import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { markBootFailed, resetBootStateForTests } from "@/lib/config/boot-state";

let testDb: TestDb | null = null;
let failNext = false;
let dbProbes = 0;

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    dbProbes += 1;
    if (failNext) throw new Error("connection refused to db:5432");
    return testDb;
  },
}));

const { GET } = await import("./route");

/**
 * Container liveness/readiness probe.
 *
 * deploy/podman/ needs an endpoint the runtime can poll to decide whether the
 * app is up and whether it can reach its database — a container that is
 * "running" but cannot talk to Postgres should not be considered healthy.
 *
 * It is unauthenticated by necessity (a health check has no session), so it
 * must leak nothing: no version, no hostname, no connection string, and no
 * error text from the database, since a connection error typically contains
 * the host and port and sometimes the user.
 */
describe("GET /api/health", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    failNext = false;
    dbProbes = 0;
  });

  afterEach(async () => {
    resetBootStateForTests();
    if (testDb) await closeTestDb(testDb);
    testDb = null;
  });

  it("returns 200 and status ok when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 when the database cannot be reached", async () => {
    failNext = true;
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: "degraded", database: "unreachable" });
  });

  it("leaks nothing about the database on failure", async () => {
    failNext = true;
    const body = await (await GET()).text();

    expect(body).not.toContain("db:5432");
    expect(body).not.toContain("connection refused");
    expect(body).not.toMatch(/postgres:\/\//);
  });

  it("is not cached — a stale 200 would hide an outage", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  // register() (instrumentation.ts) refuses to boot an invalid production
  // configuration and sets this flag. If the process.exit does not take, or
  // a platform restarts into a half-configured server, readiness must still
  // fail so the load balancer never routes to it.
  describe("after a failed boot", () => {
    it("returns 503 boot_failed without consulting the database", async () => {
      markBootFailed("production configuration is invalid: DATABASE_URL is missing");
      const res = await GET();
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ status: "boot_failed" });
      expect(dbProbes).toBe(0);
    });

    it("does not reveal why boot failed", async () => {
      markBootFailed("production configuration is invalid: DATABASE_URL is missing");
      const body = await (await GET()).text();
      expect(body).not.toContain("DATABASE_URL");
      expect(body).not.toContain("configuration");
    });

    it("is not cached", async () => {
      markBootFailed("boom");
      const res = await GET();
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
    });

    it("recovers the normal shape once no failure is recorded", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status: "ok", database: "ok" });
    });
  });
});
