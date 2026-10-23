import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool as PgPool } from "pg";
import { closeDb, getDb, localPgliteDirectory } from "./client";

const originalDirectory = process.env.JEEVES_PGLITE_DIR;
const keys = ["DATABASE_URL", "POSTGRES_URL", "VERCEL", "JEEVES_DB_DRIVER"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(async () => {
  // Drop any pool a test opened so the memoized handle never leaks across tests.
  await closeDb();
  vi.restoreAllMocks();
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalDirectory === undefined) delete process.env.JEEVES_PGLITE_DIR;
  else process.env.JEEVES_PGLITE_DIR = originalDirectory;
});

describe("localPgliteDirectory", () => {
  it("keeps the existing repo-local default", () => {
    delete process.env.JEEVES_PGLITE_DIR;
    expect(localPgliteDirectory()).toBe("./.pglite");
  });

  it("uses an explicit disposable runner directory", () => {
    process.env.JEEVES_PGLITE_DIR = "/tmp/jeeves-playwright-example";
    expect(localPgliteDirectory()).toBe("/tmp/jeeves-playwright-example");
  });

  it("does not accept a blank override", () => {
    process.env.JEEVES_PGLITE_DIR = "   ";
    expect(localPgliteDirectory()).toBe("./.pglite");
  });
});

describe("getDb runtime configuration", () => {
  it("fails before opening local PGlite when Vercel has no network URL", () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.VERCEL = "1";
    expect(() => getDb()).toThrow(/DATABASE_URL or POSTGRES_URL/);
  });
});

describe("getDb node-postgres pool", () => {
  function openPgPool(): PgPool {
    delete process.env.POSTGRES_URL;
    delete process.env.VERCEL;
    process.env.DATABASE_URL = "postgres://app:hunter2@db.internal:5432/jeeves";
    process.env.JEEVES_DB_DRIVER = "pg";
    // Pools connect lazily, so no server is needed to build one.
    return (getDb() as unknown as { $client: PgPool }).$client;
  }

  it("handles pool 'error' events instead of letting them crash the process", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = openPgPool();

    // An EventEmitter with no 'error' listener rethrows, and an uncaught
    // throw on the pool's idle-client path takes the whole server down. This
    // is what an RDS failover or a restart delivers to every idle connection.
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain("terminating connection due to administrator command");
  });

  it("never logs the connection string or its credentials", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = openPgPool();

    pool.emit("error", new Error("Connection terminated unexpectedly"));

    const logged = log.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("postgres://");
  });

  it("keeps serving the same pool after an error event", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = openPgPool();
    pool.emit("error", new Error("boom"));
    expect((getDb() as unknown as { $client: PgPool }).$client).toBe(pool);
  });
});
