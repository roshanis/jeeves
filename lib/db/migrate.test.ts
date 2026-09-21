import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "./test-client";
import { applyMigrations, describeMigrationTarget } from "./migrate";
import { auditEvents, initiatives } from "./schema";

/**
 * Migration-runner tests.
 *
 * These exist because, before `lib/db/migrate.ts`, the ONLY code path that
 * applied migrations was `scripts/seed.ts` — which wipes every table first,
 * including a `DISABLE TRIGGER ALL` on `audit_events` so it can delete the
 * append-only audit log. Applying a schema change to a live deployment
 * therefore meant destroying the compliance record the product exists to
 * keep. `applyMigrations()` is the non-destructive path, and the assertions
 * below are the properties that make it safe to point at a real database:
 *
 *  1. it is idempotent (safe to re-run),
 *  2. it PRESERVES existing rows — the whole point,
 *  3. it leaves the `audit_events` append-only trigger ARMED afterwards, so
 *     a migration run can never silently leave the audit log writable.
 */
describe("lib/db/migrate — non-destructive migration runner", () => {
  let db: TestDb;
  const now = new Date("2026-07-01T00:00:00Z");

  beforeEach(async () => {
    // createTestDb() already runs every migration once.
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("is idempotent — re-running against an up-to-date database is a no-op", async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it("selects the migrator from the actual PGlite handle even when a network URL exists", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://unused.example/db";
    try {
      await expect(applyMigrations(db)).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("does not validate a Supabase runtime pool URL when migrating a supplied PGlite handle", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousPostgresUrl = process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = "postgresql://u:p@aws-0-example.pooler.supabase.com:6543/postgres";
    try {
      await expect(applyMigrations(db)).resolves.toBeUndefined();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousPostgresUrl === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = previousPostgresUrl;
    }
  });

  it("preserves existing rows, including the append-only audit log", async () => {
    await db.insert(initiatives).values({
      id: "init-survives",
      slug: "survives-migration",
      title: "Survives Migration",
      requester: "Priya Raman",
      state: "intake_draft",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(auditEvents).values({
      id: "ae-survives",
      initiativeId: "init-survives",
      ts: now,
      actor: "priya-raman",
      actorRole: "requester",
      action: "intake.created",
      detail: "must survive a migration run",
    });

    await applyMigrations(db);

    expect(await db.select().from(initiatives)).toHaveLength(1);

    const events = await db.select().from(auditEvents);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("intake.created");
    expect(events[0]!.detail).toBe("must survive a migration run");
  });

  it("leaves the audit_events append-only trigger armed after running", async () => {
    await db.insert(auditEvents).values({
      id: "ae-trigger-check",
      ts: now,
      actor: "system",
      actorRole: "system",
      action: "test",
      detail: "test detail",
    });

    await applyMigrations(db);

    // The seed path disables these triggers so it can wipe the table. A
    // migration run must never leave them disabled.
    await expect(
      db.execute(sql`delete from audit_events where id = 'ae-trigger-check'`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/i) },
    });
    await expect(
      db.execute(sql`update audit_events set detail = 'tampered'`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/i) },
    });
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });

  it("describes configured migration targets opaquely", () => {
    expect(
      describeMigrationTarget(
        "postgres://someuser:sup3rs3cret@ep-cool-name-123.eu-central-1.aws.neon.tech/jeeves?sslmode=require",
      ),
    ).toBe("Postgres (configured migration connection)");
  });

  it("names plain Postgres as Postgres, not Neon", () => {
    // It said "Neon Postgres — 127.0.0.1/jeeves" against a real PostgreSQL 16
    // container, which is the vendor confusion driver-select.ts exists to
    // stop. The label now follows the driver that will actually be used.
    expect(describeMigrationTarget("postgres://postgres:test@db:5432/jeeves")).toBe("Postgres (configured migration connection)");
  });

  it("describes the local store when DATABASE_URL is unset", () => {
    expect(describeMigrationTarget(undefined)).toBe("local PGlite store (./.pglite)");
  });

  it("never leaks a password or username into the target description", () => {
    const described = describeMigrationTarget(
      "postgres://admin_user:hunter2@host.neon.tech/jeeves?sslmode=require",
    );
    expect(described).not.toContain("hunter2");
    expect(described).not.toContain("admin_user");
  });

  it("falls back to an opaque label rather than echoing an unparseable URL", () => {
    // Never print something we could not parse — it may still hold secrets.
    const described = describeMigrationTarget("not-a-url-but-maybe-secret");
    expect(described).not.toContain("not-a-url-but-maybe-secret");
    expect(described).toBe("Postgres (configured migration connection)");
  });
});
