import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl, migrationPoolConfig, postgresPoolConfig } from "./connection-config";

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

describe("DATABASE_SSL_CA on non-Supabase hosts", () => {
  const rds = "postgresql://user:example@jeeves.cluster-abc.us-east-1.rds.amazonaws.com:5432/jeeves";
  const ca = "test-ca";
  const verified = { rejectUnauthorized: true, ca };

  it("applies the CA when the URL has no sslmode", () => {
    const config = postgresPoolConfig(rds, ca);
    expect(config.ssl).toEqual(verified);
    expect(config.connectionString).toBe(rds);
    expect(config.max).toBeUndefined();
  });

  it.each(["prefer", "require", "verify-ca", "verify-full"])("applies the CA and strips sslmode=%s", (mode) => {
    const config = postgresPoolConfig(`${rds}?sslmode=${mode}&application_name=jeeves`, ca);
    expect(config.ssl).toEqual(verified);
    expect(config.connectionString).toBe(`${rds}?application_name=jeeves`);
    expect(config.max).toBeUndefined();
  });

  it.each(["sslmode=disable", "sslmode=no-verify", "ssl=false", "ssl=0", "ssl=no-verify"])
  ("rejects a CA combined with TLS-off URL option: %s", (query) => {
    let message = "";
    try { postgresPoolConfig(`${rds}?${query}`, ca); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/DATABASE_SSL_CA/);
    expect(message).not.toContain("example");
    expect(message).not.toContain("rds.amazonaws.com");
  });

  it.each(["sslrootcert=/x.pem", "sslcert=/c.pem", "sslkey=/k.pem", "sslnegotiation=direct", "uselibpqcompat=true"])
  ("rejects a CA combined with URL TLS source: %s", (query) => {
    let message = "";
    try { postgresPoolConfig(`${rds}?${query}`, ca); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/DATABASE_SSL_CA/);
    expect(message).not.toContain("example");
    expect(message).not.toContain("rds.amazonaws.com");
  });

  it("treats a whitespace-only CA as unset", () => {
    const config = postgresPoolConfig(rds, "  \n");
    expect(config).not.toHaveProperty("ssl");
    expect(config.connectionString).toBe(rds);
  });

  it("passes the URL through untouched without a CA", () => {
    const url = `${rds}?sslmode=require`;
    const config = postgresPoolConfig(url);
    expect(config.connectionString).toBe(url);
    expect(config.ssl).toBeUndefined();
  });

  it("keeps the explicit CA through node-postgres's own option merge", () => {
    const ConnectionParameters = createRequire(import.meta.url)("pg/lib/connection-parameters");
    const params = new ConnectionParameters(postgresPoolConfig(`${rds}?sslmode=require`, ca));
    expect(params.ssl.ca).toBe(ca);
    expect(params.ssl.rejectUnauthorized).toBe(true);
  });
});

describe("runtime and migration pool limits", () => {
  const generic = "postgresql://user:example@db.internal.example:5432/jeeves";

  it("sets statement and idle-in-transaction timeouts and an application name", () => {
    const config = postgresPoolConfig(generic, undefined, {});
    expect(config.statement_timeout).toBe(60_000);
    expect(config.idle_in_transaction_session_timeout).toBe(60_000);
    expect(config.application_name).toBeTruthy();
    expect(config.keepAlive).toBe(true);
    expect(config.max).toBeUndefined();
  });

  it("takes a valid DATABASE_POOL_MAX and ignores an invalid one", () => {
    expect(postgresPoolConfig(generic, undefined, { DATABASE_POOL_MAX: "4" }).max).toBe(4);
    expect(postgresPoolConfig(generic, undefined, { DATABASE_POOL_MAX: "0" }).max).toBeUndefined();
    expect(postgresPoolConfig(generic, undefined, { DATABASE_POOL_MAX: "abc" }).max).toBeUndefined();
  });

  it("keeps the Supabase pool at one connection whatever DATABASE_POOL_MAX says", () => {
    expect(postgresPoolConfig(pooled, undefined, { DATABASE_POOL_MAX: "8" }).max).toBe(1);
  });

  it("gives the migration connection a lock_timeout and no statement_timeout", () => {
    const config = migrationPoolConfig(generic, undefined, {});
    expect(config.options).toBe("-c lock_timeout=10000");
    expect(config.statement_timeout).toBeUndefined();
    expect(config.max).toBe(1);
    expect(migrationPoolConfig(generic, undefined, { DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "2500" }).options)
      .toBe("-c lock_timeout=2500");
  });
});
