import { afterEach, describe, expect, it } from "vitest";
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
