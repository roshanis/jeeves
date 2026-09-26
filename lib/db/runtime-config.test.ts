import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl, assertRuntimeDatabaseConfigured } from "./runtime-config";

describe("runtime database URL", () => {
  it("prefers DATABASE_URL and trims whitespace", () => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: "  postgres://primary/db  ", POSTGRES_URL: "postgres://fallback/db" }))
      .toBe("postgres://primary/db");
  });

  it("uses the Vercel integration POSTGRES_URL alias when needed", () => {
    expect(runtimeDatabaseUrl({ POSTGRES_URL: " postgres://fallback/db " })).toBe("postgres://fallback/db");
  });

  it("returns undefined when no non-empty URL is configured", () => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: "  ", POSTGRES_URL: "" })).toBeUndefined();
  });

  it("fails closed on Vercel when no network database URL is configured", () => {
    expect(() => assertRuntimeDatabaseConfigured(undefined, "1")).toThrow(/DATABASE_URL or POSTGRES_URL/);
    expect(() => assertRuntimeDatabaseConfigured(undefined, undefined)).not.toThrow();
    expect(() => assertRuntimeDatabaseConfigured("postgres://db", "1")).not.toThrow();
  });
});
