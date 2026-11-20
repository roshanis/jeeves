// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neonConfig } from "@neondatabase/serverless";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { postgresPoolConfig } from "./connection-config";
import { PG_REFUSES, classifyPgSsl, databaseTlsPosture, effectivePgSsl } from "./tls-posture";

const ConnectionParameters = createRequire(import.meta.url)("pg/lib/connection-parameters");

const dir = mkdtempSync(join(tmpdir(), "jeeves-tls-"));
const pem = join(dir, "ca.pem");
writeFileSync(pem, "placeholder-ca");

const HOST = "db.internal";
const url = (query = "", host = HOST) => `postgres://u:p@${host}:5432/j${query ? `?${query}` : ""}`;
const posture = (databaseUrl: string, env: Record<string, string | undefined> = {}) =>
  databaseTlsPosture({ DATABASE_URL: databaseUrl, ...env });

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("databaseTlsPosture", () => {
  it("exempts a database on this machine", () => {
    for (const databaseUrl of [
      "postgres://u:p@localhost:5432/j", "postgres://u:p@LOCALHOST./j", "postgres://u:p@127.0.0.1/j",
      "postgres://u:p@127.8.9.10/j", "postgres://u:p@[::1]:5432/j", "postgres://u:p@[0:0:0:0:0:0:0:1]/j",
      "postgres://u:p@%2Fvar%2Frun%2Fpostgresql/j", "postgres://u:p@localhost/j?host=/var/run/postgresql",
    ]) expect(posture(databaseUrl), databaseUrl).toEqual({ kind: "loopback" });
  });

  it("does not exempt names that only look local", () => {
    for (const host of ["127.1", "0x7f.0.0.1", "127.0.0.01", "[::ffff:7f00:1]", "localhost.example.com", "10.0.0.5", "db"]) {
      expect(posture(url("", host)), host).toEqual({ kind: "unverified", cause: "plaintext" });
    }
  });

  it("reports plaintext to another host", () => {
    for (const query of ["", "sslmode=disable", "ssl=0", "ssl=", "sslmode=verify-full&sslmode=disable"]) {
      expect(posture(url(query)), query).toEqual({ kind: "unverified", cause: "plaintext" });
    }
    for (const mode of ["disable", "bogus"]) {
      expect(posture(url(), { PGSSLMODE: mode }), mode).toEqual({ kind: "unverified", cause: "plaintext" });
    }
    // pg-connection-string re-encodes this string, so the hex-escaped key is NOT read as sslmode.
    expect(posture("postgres://u:p@db.internal:5432/j?sslmode=disable&ssl%6dode=verify-full&x=%zz"))
      .toEqual({ kind: "unverified", cause: "plaintext" });
  });

  it("reports certificate verification turned off", () => {
    for (const query of ["sslmode=no-verify", "ssl=no-verify", "sslmode=require&uselibpqcompat=true", "sslmode=prefer&uselibpqcompat=true"]) {
      expect(posture(url(query)), query).toEqual({ kind: "unverified", cause: "verification_off" });
    }
    expect(posture(url(), { PGSSLMODE: "no-verify" })).toEqual({ kind: "unverified", cause: "verification_off" });
    for (const query of [`uselibpqcompat=true&sslmode=verify-ca&sslrootcert=${pem}`, `uselibpqcompat=true&sslmode=require&sslrootcert=${pem}`]) {
      expect(posture(url(query)), query).toEqual({ kind: "unverified", cause: "host_name_not_checked" });
    }
    for (const query of ["ssl=false", "ssl=disable"]) {
      expect(posture(url(query)), query).toEqual({ kind: "unverified", cause: "unrecognised_ssl_option" });
    }
  });

  it("accepts what the driver really verifies", () => {
    for (const query of [
      "sslmode=verify-full", "sslmode=require", "sslmode=prefer", "sslmode=verify-ca", "sslmode=allow", "ssl=true", "ssl=1",
      "ssl=0&sslmode=require", "sslmode=disable&sslmode=verify-full", "uselibpqcompat=true&sslmode=verify-full",
      "uselibpqcompat=TRUE&sslmode=require", "sslnegotiation=direct", `sslrootcert=${pem}`, "sslmode=%76erify-full",
    ]) expect(posture(url(query)), query).toEqual({ kind: "verified" });
    expect(posture(url(), { PGSSLMODE: "require" })).toEqual({ kind: "verified" });
    expect(posture(url(), { DATABASE_SSL_CA: "PEM" })).toEqual({ kind: "verified" });
    expect(posture(url("sslmode=require"), { DATABASE_SSL_CA: "PEM" })).toEqual({ kind: "verified" });
    expect(posture("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres")).toEqual({ kind: "verified" });
    expect(posture("postgres://u:p@ep-x.us-east-1.aws.neon.tech/db")).toEqual({ kind: "verified" });
    expect(posture(url(), { JEEVES_DB_DRIVER: "neon" })).toEqual({ kind: "verified" });
  });

  it("relies on the Neon driver always using wss", () => {
    expect(neonConfig.useSecureWebSocket).toBe(true);
  });

  it("counts NODE_TLS_REJECT_UNAUTHORIZED=0 only where the option is not explicit", () => {
    const off = { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    const cause = { kind: "unverified", cause: "node_tls_reject_unauthorized" };
    expect(posture(url("sslmode=verify-full"), off)).toEqual(cause);
    expect(posture(url("ssl=true"), off)).toEqual(cause);
    expect(posture("postgres://u:p@ep-x.us-east-1.aws.neon.tech/db", off)).toEqual(cause);
    expect(posture(url(), { ...off, PGSSLMODE: "verify-full" })).toEqual(cause);
    expect(posture(url(), { ...off, DATABASE_SSL_CA: "PEM" })).toEqual({ kind: "verified" });
    expect(posture("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres", off)).toEqual({ kind: "verified" });
    for (const value of ["1", "false", ""]) {
      expect(posture(url("sslmode=verify-full"), { NODE_TLS_REJECT_UNAUTHORIZED: value }), value).toEqual({ kind: "verified" });
    }
  });

  it("reports settings the connection layer or the driver refuses, without values", () => {
    const refused = [
      posture(url("sslmode=no-verify"), { DATABASE_SSL_CA: "PEM" }),
      posture(url("uselibpqcompat=true&sslmode=verify-ca")),
      posture(url("ssl=0&sslnegotiation=direct")),
      posture(url("sslnegotiation=bogus-value")),
      posture(url(), { PGSSLNEGOTIATION: "bogus-value" }),
      posture(url("ssl=0"), { PGSSLNEGOTIATION: "direct" }),
      posture("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres?sslmode=disable"),
      posture(url("port=6543")),
      posture("not a url", { JEEVES_DB_DRIVER: "pg" }),
      posture("postgres://u:p%@[2001:db8::1]:5432/j", { JEEVES_DB_DRIVER: "pg" }),
    ];
    for (const result of refused) {
      expect(result.kind).toBe("refused");
      const message = (result as { message: string }).message;
      for (const secret of ["bogus-value", "db.internal", "u:p"]) expect(message).not.toContain(secret);
    }
    expect((refused[0] as { message: string }).message).toContain("DATABASE_SSL_CA");
    // A URL node-postgres cannot parse gets its own message, not the TLS-options one.
    const unparseable = (refused[refused.length - 1] as { message: string }).message;
    expect(unparseable).toContain("node-postgres cannot parse it");
    expect(unparseable).not.toContain("TLS options");
    expect(databaseTlsPosture({})).toEqual({ kind: "no_database" });
    expect(databaseTlsPosture({ DATABASE_URL: "  " })).toEqual({ kind: "no_database" });
  });
});

describe("agrees with node-postgres on every option combination", () => {
  const modes = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full", "no-verify", "bogus", ""];
  const queries = [
    "", ...modes.map((m) => `sslmode=${m}`),
    ...["true", "1", "0", "false", "no-verify", "disable", ""].map((v) => `ssl=${v}`),
    "ssl=0&sslmode=require", "sslmode=require&sslmode=disable", "sslmode=disable&sslmode=require",
    ...modes.map((m) => `uselibpqcompat=true&sslmode=${m}`), "uselibpqcompat=true", "uselibpqcompat=TRUE&sslmode=require",
    "sslnegotiation=direct", "ssl=0&sslnegotiation=direct", "sslnegotiation=postgres", "sslnegotiation=bogus",
    `sslrootcert=${pem}`, `sslcert=${pem}&sslkey=${pem}`,
    ...["require", "verify-ca", "prefer"].map((m) => `uselibpqcompat=true&sslmode=${m}&sslrootcert=${pem}`),
    "sslmode=disable&ssl%6dode=verify-full&x=%zz", "sslmode=%76erify-full&x=%zz", "sslmode=no-%76erify&x=%zz",
    "sslmode=verify-full&ssl%6dode=no-verify&x=%zz",
  ];
  const withPassword = (query: string, password: string) => `postgres://u:${password}@db.internal:5432/j${query ? `?${query}` : ""}`;

  it("matches ConnectionParameters.ssl for the whole matrix", () => {
    let compared = 0;
    for (const password of ["p", "p%zz"]) {
      for (const query of queries) {
        for (const pgsslmode of [undefined, "disable", "prefer", "require", "verify-full", "no-verify", "bogus"]) {
          for (const negotiation of [undefined, "direct", "bogus"]) {
            for (const ca of [undefined, "PEM"]) {
              const databaseUrl = withPassword(query, password);
              const env = { PGSSLMODE: pgsslmode, PGSSLNEGOTIATION: negotiation };
              let config;
              try {
                config = postgresPoolConfig(databaseUrl, ca, env);
              } catch {
                continue;
              }
              vi.stubEnv("PGSSLMODE", pgsslmode ?? "");
              vi.stubEnv("PGSSLNEGOTIATION", negotiation ?? "");
              let real: unknown;
              try {
                real = new ConnectionParameters(config).ssl;
              } catch {
                real = PG_REFUSES;
              }
              const label = `${query} | ${password} | ${pgsslmode} | ${negotiation} | ${ca}`;
              expect(classifyPgSsl(effectivePgSsl(config, env), env), label).toEqual(classifyPgSsl(real, env));
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});
