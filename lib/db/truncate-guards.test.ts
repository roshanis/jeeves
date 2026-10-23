// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "./test-client";
import { auditEvents, initiatives } from "./schema";

/**
 * Migration 0014 — TRUNCATE guards.
 *
 * 0002 and 0011 make audit_events and the evidence tables append-only against
 * row-level UPDATE and DELETE. Row triggers never fire for TRUNCATE, so until
 * 0014 a single `TRUNCATE initiatives CASCADE` erased the compliance record
 * (CASCADE walks the audit_events and evidence_* foreign keys) without
 * touching a guard. These tests pin the statement-level BEFORE TRUNCATE
 * triggers, including the CASCADE routes in.
 */
describe("migration 0014 — append-only TRUNCATE guards", () => {
  let db: TestDb;
  const now = new Date("2026-07-01T00:00:00Z");

  // drizzle wraps driver errors ("Failed query: ..."); the trigger's message
  // is on `cause`.
  async function expectGuarded(statement: string | ReturnType<typeof sql>): Promise<void> {
    const query = typeof statement === "string" ? sql.raw(statement) : statement;
    await expect(db.execute(query)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/is append-only: TRUNCATE is not permitted/) },
    });
  }

  async function seedInitiativeWithAudit(): Promise<void> {
    await db.insert(initiatives).values({
      id: "init-t",
      slug: "truncate-guard",
      title: "Truncate Guard",
      requester: "Priya Raman",
      state: "in_review",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(auditEvents).values({
      id: "ae-t",
      initiativeId: "init-t",
      ts: now,
      actor: "priya-raman",
      actorRole: "requester",
      action: "intake.created",
      detail: "must survive a TRUNCATE attempt",
    });
  }

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it.each([
    ["audit_events", "TRUNCATE audit_events"],
    ["evidence_documents", "TRUNCATE evidence_documents"],
    ["evidence_assessments", "TRUNCATE evidence_assessments"],
    // evidence_packets is referenced by evidence_assessments, so a bare
    // TRUNCATE is rejected by the FK check before any trigger. The operator
    // who reaches for CASCADE must still be stopped by the guard.
    ["evidence_packets", "TRUNCATE evidence_packets CASCADE"],
  ])("rejects TRUNCATE on %s", async (table, statement) => {
    await expect(db.execute(sql.raw(statement))).rejects.toMatchObject({
      cause: { message: expect.stringContaining(`${table} is append-only: TRUNCATE is not permitted`) },
    });
  });

  it.each([
    "TRUNCATE initiatives CASCADE",
    "TRUNCATE review_cycles CASCADE",
    "TRUNCATE control_definitions CASCADE",
    "TRUNCATE initiatives, audit_events, evidence_documents RESTART IDENTITY CASCADE",
  ])("rejects `%s`, which reaches the protected tables only through foreign keys", async (statement) => {
    await expectGuarded(statement);
  });

  it("leaves every row in place after a rejected TRUNCATE CASCADE", async () => {
    await seedInitiativeWithAudit();

    await expectGuarded("TRUNCATE initiatives CASCADE");

    expect(await db.select().from(initiatives)).toHaveLength(1);
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });

  it("rejects a TRUNCATE even when the protected tables are empty", async () => {
    // Statement-level: the guard must not depend on there being rows to lose.
    await expectGuarded("TRUNCATE audit_events");
  });

  it("registers exactly the expected statement-level BEFORE TRUNCATE triggers", async () => {
    // pg_trigger.tgtype bits: 1 = row-level, 2 = BEFORE, 32 = TRUNCATE.
    const result = await db.execute<{ table_name: string; tgtype: number }>(sql`
      select c.relname as table_name, t.tgtype::int as tgtype
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and (t.tgtype & 32) = 32
      order by c.relname
    `);
    const rows = result.rows;
    expect(rows.map((r) => r.table_name)).toEqual([
      "audit_events",
      "evidence_assessments",
      "evidence_documents",
      "evidence_packets",
    ]);
    for (const row of rows) {
      expect(row.tgtype & 1, `${row.table_name} must be a statement-level trigger`).toBe(0);
      expect(row.tgtype & 2, `${row.table_name} must fire BEFORE`).toBe(2);
    }
  });

  it("does not over-reach: unprotected tables can still be truncated", async () => {
    await expect(db.execute(sql`TRUNCATE rate_limit_buckets`)).resolves.toBeDefined();
    await expect(db.execute(sql`TRUNCATE run_budget`)).resolves.toBeDefined();
    await expect(db.execute(sql`TRUNCATE sessions`)).resolves.toBeDefined();
  });

  it("is still armed after migrations are re-applied", async () => {
    const { applyMigrations } = await import("./migrate");
    await applyMigrations(db);
    await expectGuarded("TRUNCATE audit_events");
  });

  it("DISABLE TRIGGER USER is enough to run a deliberate maintenance TRUNCATE, and ENABLE re-arms it", async () => {
    // The sanctioned escape hatch for seed/reset on RDS, where the master user
    // is not a superuser and so cannot DISABLE TRIGGER ALL.
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
    await expect(db.execute(sql`TRUNCATE audit_events`)).resolves.toBeDefined();
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
    await expectGuarded("TRUNCATE audit_events");
  });
});
