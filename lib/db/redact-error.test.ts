import { describe, expect, it } from "vitest";
import { redactDbError, redactTransactionErrors } from "./redact-error";
import { createTestDb, closeTestDb } from "./test-client";
import { sql } from "drizzle-orm";

const SECRET = "SECRET-TOKEN-abc123";

function wrap(cause?: Error): Error {
  return Object.assign(new Error(`Failed query: insert into sessions params: ${SECRET}`), {
    query: "insert into sessions (token) values ($1)",
    params: [SECRET],
    ...(cause ? { cause } : {}),
  });
}

function everything(err: Error): string {
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

describe("redactDbError", () => {
  it("keeps the SQLSTATE and constraint of a wrapped unique violation and drops the detail", () => {
    const cause = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint: "sessions_pkey",
      detail: `Key (token)=(${SECRET}) already exists.`,
    });
    const out = redactDbError(wrap(cause)) as Error & { code?: string; constraint?: string };
    expect(out.message).toBe("Database query failed (SQLSTATE 23505, constraint sessions_pkey)");
    expect(out.code).toBe("23505");
    expect(out.constraint).toBe("sessions_pkey");
    expect(everything(out)).not.toContain(SECRET);
  });

  it("appends the reason of a wrapped connection error without labelling it a SQLSTATE", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const out = redactDbError(wrap(cause)) as Error & { code?: string };
    expect(out.message).toBe("Database query failed: connect ECONNREFUSED 127.0.0.1:5432");
    expect(out.message).not.toContain("SQLSTATE");
    expect(out.code).toBe("ECONNREFUSED");
    expect(everything(out)).not.toContain(SECRET);
  });

  it("collapses newlines and caps the appended reason at 200 characters", () => {
    const cause = new Error(`line one\nline two ${"x".repeat(400)}`);
    const out = redactDbError(wrap(cause));
    const reason = out.message.slice("Database query failed: ".length);
    expect(reason).not.toContain("\n");
    expect(reason.length).toBe(200);
  });

  it("leaks nothing from the wrapper's own message when there is no cause", () => {
    const out = redactDbError(wrap());
    expect(out.message).toBe("Database query failed");
    expect(everything(out)).not.toContain(SECRET);
  });

  it("does not append a cause that is itself a query error", () => {
    const inner = Object.assign(new Error(`Failed query: x params: ${SECRET}`), { query: "x", params: [SECRET] });
    const out = redactDbError(wrap(inner));
    expect(out.message).toBe("Database query failed");
    expect(everything(out)).not.toContain(SECRET);
  });

  it("passes a non-query error through unchanged", () => {
    const err = new Error("boom");
    expect(redactDbError(err)).toBe(err);
  });
});

describe("redactTransactionErrors", () => {
  it("rewrites a failed statement inside a transaction, keeping SQLSTATE and the statement placeholders only", async () => {
    const db = redactTransactionErrors(await createTestDb());
    try {
      const err = (await db
        .transaction(async (tx) => {
          await tx.execute(sql`insert into initiatives (id) values (${"marker-4f1c"})`);
        })
        .then(
          () => null,
          (e: unknown) => e,
        )) as (Error & { code?: string; statement?: string }) | null;
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).not.toContain("marker-4f1c");
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain("marker-4f1c");
      expect(err!.code).toMatch(/^[0-9A-Z]{5}$/);
      expect(err!.statement).toContain("insert into initiatives");
    } finally {
      await closeTestDb(db);
    }
  });

  it("rethrows an application error as the very same object and returns a resolved value", async () => {
    const db = redactTransactionErrors(await createTestDb());
    try {
      const mine = new Error("conflict");
      await expect(db.transaction(async () => { throw mine; })).rejects.toBe(mine);
      await expect(db.transaction(async () => 42)).resolves.toBe(42);
    } finally {
      await closeTestDb(db);
    }
  });

  it("is idempotent", async () => {
    const db = await createTestDb();
    try {
      redactTransactionErrors(db);
      const once = db.transaction;
      redactTransactionErrors(db);
      expect(db.transaction).toBe(once);
    } finally {
      await closeTestDb(db);
    }
  });
});
