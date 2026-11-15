import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMigrationFailure } from "./migrate";

afterEach(() => vi.unstubAllEnvs());

describe("describeMigrationFailure", () => {
  it("names the SQLSTATE, constraint and table, not the row-value detail, without leaking the connection string", () => {
    const url = "postgres://jeeves:s3cret@db.example.com:5432/jeeves";
    vi.stubEnv("DATABASE_URL", url);
    const cause = Object.assign(
      new Error(`duplicate key value violates unique constraint (connecting via ${url})`),
      { code: "23505", constraint: "initiative_decisions_uniq", table: "initiative_decisions", detail: "Key (initiative_id)=(1) already exists." },
    );
    const wrapped = Object.assign(new Error("Failed query: insert ..."), { cause });
    const text = describeMigrationFailure(wrapped);
    expect(text).toContain("23505");
    expect(text).toContain("initiative_decisions_uniq");
    expect(text).toContain("initiative_decisions");
    expect(text).not.toContain("already exists");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("db.example.com");
  });

  it.each(["DATABASE_URL", "DATABASE_MIGRATION_URL", "POSTGRES_URL"])(
    "redacts the host and password of %s when they appear outside a URL",
    (name) => {
      vi.stubEnv(name, "postgres://jeeves:s3cret@db.example.com:5432/jeeves");
      const dns = describeMigrationFailure(Object.assign(new Error("getaddrinfo ENOTFOUND db.example.com"), { code: "ENOTFOUND" }));
      expect(dns).toContain("ENOTFOUND");
      expect(dns).not.toContain("db.example.com");
      const pw = describeMigrationFailure(new Error("password authentication failed for s3cret"));
      expect(pw).not.toContain("s3cret");
    },
  );

  it("redacts a password that the URL carries percent-encoded, in both spellings", () => {
    vi.stubEnv("DATABASE_URL", "postgres://jeeves:p%40ss%2Fw0rd@db.example.com:5432/jeeves");
    const text = describeMigrationFailure(
      new Error('password authentication failed: tried "p@ss/w0rd" (sent as p%40ss%2Fw0rd)'),
    );
    expect(text).not.toContain("p@ss/w0rd");
    expect(text).not.toContain("p%40ss%2Fw0rd");
    expect(text).toContain("password authentication failed");
  });

  it("leaves a single-label host alone, so a compose service name does not blank ordinary words", () => {
    vi.stubEnv("DATABASE_URL", "postgres://jeeves:s3cret-long-value@postgres:5432/jeeves");
    const text = describeMigrationFailure(
      Object.assign(new Error('role "postgres" does not exist'), { code: "28000" }),
    );
    expect(text).toContain('role "postgres" does not exist');
    vi.stubEnv("DATABASE_URL", "postgres://jeeves:s3cret-long-value@localhost:5432/jeeves");
    expect(describeMigrationFailure(new Error("connect ECONNREFUSED localhost:5432"))).toContain("localhost:5432");
  });

  it("still redacts an IP-address host", () => {
    vi.stubEnv("DATABASE_URL", "postgres://jeeves:s3cret-long-value@10.20.30.40:5432/jeeves");
    const text = describeMigrationFailure(new Error("connect ETIMEDOUT 10.20.30.40:5432"));
    expect(text).toContain("ETIMEDOUT");
    expect(text).not.toContain("10.20.30.40");
  });

  it("still reports an error without a code", () => {
    expect(describeMigrationFailure(new Error("ENOENT: no such file ./drizzle/meta/_journal.json"))).toContain("_journal.json");
  });
});
