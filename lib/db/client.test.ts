import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, localPgliteDirectory } from "./client";

const originalDirectory = process.env.JEEVES_PGLITE_DIR;
const keys = ["DATABASE_URL", "POSTGRES_URL", "VERCEL"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
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

describe("getDb Neon pool hardening", () => {
  it("registers an error listener that does not throw or log the URL, and bounds connect time", async () => {
    const { closeDb } = await import("./client");
    delete process.env.VERCEL;
    process.env.DATABASE_URL = "postgres://u:secret-pw@ep-x.us-east-1.aws.neon.tech/db";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      getDb();
      const slot = (globalThis as Record<symbol, unknown>)[Symbol.for("jeeves.db.cachedDb")] as {
        pool: { emit: (e: string, ...a: unknown[]) => boolean; options: { connectionTimeoutMillis?: number } };
      };
      expect(slot.pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(() => slot.pool.emit("error", new Error("terminating connection secret-pw"))).not.toThrow();
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-pw");
    } finally {
      log.mockRestore();
      await closeDb();
    }
  });
});

describe("getDb transaction error redaction", () => {
  it("returns a handle whose transaction sanitises failed statements", async () => {
    const { closeDb } = await import("./client");
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.JEEVES_PGLITE_DIR = `memory://client-test-${Date.now()}`;
    try {
      const db = getDb();
      const err = (await db
        .transaction(async (tx) => {
          await tx.execute(sql`select * from no_such_table_xyz where a = ${"marker-77aa"}`);
        })
        .then(
          () => null,
          (e: unknown) => e,
        )) as Error | null;
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).not.toContain("marker-77aa");
      expect(err!.message).not.toContain("params");
    } finally {
      await closeDb();
    }
  });
});
