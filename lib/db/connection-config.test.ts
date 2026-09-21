import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl, postgresPoolConfig } from "./connection-config";

const pooled = "postgresql://user:example@aws-0-example.pooler.supabase.com:6543/postgres";
const direct = "postgresql://user:example@db.example.supabase.co:5432/postgres";

describe("PostgreSQL connection configuration", () => {
  it("bounds Supabase runtime pool and verifies TLS", () => {
    expect(postgresPoolConfig(pooled)).toMatchObject({ max: 1, connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000, ssl: { rejectUnauthorized: true } });
  });

  it("retains optional CA and strips sslmode after validation", () => {
    expect(postgresPoolConfig(pooled + "?sslmode=require", "test-ca")).toMatchObject({
      connectionString: pooled, ssl: { rejectUnauthorized: true, ca: "test-ca" },
    });
  });

  it.each(["sslmode=disable", "sslmode=no-verify", "ssl=false", "sslrootcert=other"])
  ("rejects TLS overrides: %s", (query) => expect(() => postgresPoolConfig(pooled + "?" + query)).toThrow(/TLS|SSL/));

  it("keeps ordinary PostgreSQL URL options and TLS behavior intact", () => {
    const url = "postgresql://user:example@127.0.0.1:5432/jeeves?sslmode=disable";
    expect(postgresPoolConfig(url).connectionString).toBe(url);
    expect(postgresPoolConfig(url).ssl).toBeUndefined();
  });

  it("does not permit endpoint overrides in libpq query parameters", () => {
    expect(() => postgresPoolConfig(pooled + "?port=5432")).toThrow(/must not override/);
  });

  it("uses a dedicated migration URL and rejects Supabase transaction pooling", () => {
    expect(migrationDatabaseUrl(pooled, direct)).toBe(direct);
    expect(() => migrationDatabaseUrl(pooled)).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it("allows Neon and local migration configuration", () => {
    const neon = "postgres://u:p@ep-x.us-east-1.aws.neon.tech/db";
    expect(migrationDatabaseUrl(neon)).toBe(neon);
    expect(migrationDatabaseUrl(undefined)).toBeUndefined();
  });
});
