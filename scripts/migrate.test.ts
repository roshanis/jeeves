import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMigrationFailure } from "./migrate";

afterEach(() => vi.unstubAllEnvs());

describe("describeMigrationFailure", () => {
  it("names the SQLSTATE, constraint, table and detail without leaking the connection string", () => {
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
    expect(text).toContain("already exists");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("db.example.com");
  });

  it("still reports an error without a code", () => {
    expect(describeMigrationFailure(new Error("ENOENT: no such file ./drizzle/meta/_journal.json"))).toContain("_journal.json");
  });
});
