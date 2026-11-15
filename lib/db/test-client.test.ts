import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditEvents, initiatives } from "./schema";
import { closeTestDb, createTestDb, type TestDb } from "./test-client";

const migrateSpy = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm/pglite/migrator", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm/pglite/migrator")>();
  migrateSpy.mockImplementation(actual.migrate);
  return { ...actual, migrate: migrateSpy };
});

const opened: TestDb[] = [];
async function open(): Promise<TestDb> {
  const db = await createTestDb();
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    try {
      await closeTestDb(db);
    } catch {
      // already closed by the test
    }
  }
});

const now = new Date("2026-01-01T00:00:00Z");
const initiativeRow = (id: string) => ({
  id,
  slug: id,
  title: id,
  requester: "Priya Raman",
  state: "intake_draft" as const,
  createdAt: now,
  updatedAt: now,
});

async function userTriggers(db: TestDb): Promise<string[]> {
  const res = await db.execute(
    sql`select tgname from pg_trigger where not tgisinternal order by tgname`,
  );
  return res.rows.map((r) => String((r as { tgname: string }).tgname));
}

// The first call in a file boots a cold PGlite and replays the migrations,
// which takes several seconds on a busy machine.
describe("createTestDb", { timeout: 60_000 }, () => {
  it("replays the migrations once, not once per database", async () => {
    // Own module instance, so the count does not depend on which test ran first.
    vi.resetModules();
    const fresh = await import("./test-client");
    migrateSpy.mockClear();
    opened.push(await fresh.createTestDb());
    opened.push(await fresh.createTestDb());
    opened.push(await fresh.createTestDb());
    expect(migrateSpy).toHaveBeenCalledTimes(1);
  });

  it("returns isolated databases", async () => {
    const a = await open();
    const b = await open();
    await a.insert(initiatives).values(initiativeRow("only-in-a"));
    await a.execute(sql`create table only_in_a (id int)`);
    expect(await b.select().from(initiatives)).toHaveLength(0);
    const tables = await b.execute(
      sql`select 1 from information_schema.tables where table_name = 'only_in_a'`,
    );
    expect(tables.rows).toHaveLength(0);
  });

  it("does not leak writes of an earlier database into a later one", async () => {
    const first = await open();
    await first.insert(initiatives).values(initiativeRow("early-write"));
    const later = await open();
    expect(await later.select().from(initiatives)).toHaveLength(0);
    expect(await first.select().from(initiatives)).toHaveLength(1);
  });

  it("carries the append-only protection and the same user triggers", async () => {
    const first = await open();
    const later = await open();
    const triggers = await userTriggers(first);
    expect(triggers.length).toBeGreaterThan(0);
    expect(await userTriggers(later)).toEqual(triggers);

    await later.insert(auditEvents).values({
      id: "ae-copy",
      ts: now,
      actor: "system",
      actorRole: "system",
      action: "test",
      detail: "test detail",
    });
    await expect(
      later.execute(sql`update audit_events set detail = 'tampered'`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/i) } });
    await expect(
      later.execute(sql`delete from audit_events where id = 'ae-copy'`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/i) } });
  });

  it("records every migration in the journal", async () => {
    await open();
    const later = await open();
    const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as {
      entries: unknown[];
    };
    const res = await later.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect((res.rows[0] as { n: number }).n).toBe(journal.entries.length);
  });

  it("keeps other databases usable after one is closed", async () => {
    const a = await open();
    const b = await open();
    await closeTestDb(a);
    await b.insert(initiatives).values(initiativeRow("after-close"));
    expect(await b.select().from(initiatives)).toHaveLength(1);
  });

  it("retries the snapshot build after a failure", async () => {
    // Own module instance so the failure hits a fresh snapshot build.
    vi.resetModules();
    const fresh = await import("./test-client");
    migrateSpy.mockClear();
    migrateSpy.mockRejectedValueOnce(new Error("boom"));
    await expect(fresh.createTestDb()).rejects.toThrow("boom");
    const db = await fresh.createTestDb();
    opened.push(db);
    expect(await db.select().from(initiatives)).toHaveLength(0);
  });
});
