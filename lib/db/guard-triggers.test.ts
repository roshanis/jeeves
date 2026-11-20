// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "./test-client";
import { auditEvents, initiatives } from "./schema";
import { GUARD_TRIGGERS, rearmGuardTriggers } from "./guard-triggers";

/**
 * Migration 0017 — guard triggers ENABLE ALWAYS.
 *
 * A trigger in the default state 'O' does not fire in a session that sets
 * session_replication_role = replica, so a role allowed to set it could rewrite
 * audit_events past the guards. 'A' fires in every session. DISABLE TRIGGER
 * USER followed by ENABLE TRIGGER USER (the seed's maintenance wipe) would put
 * every trigger back to 'O' silently, so the guards are re-armed by name.
 */
describe("guard triggers are ENABLE ALWAYS", () => {
  let db: TestDb;
  const now = new Date("2026-07-01T00:00:00Z");

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await closeTestDb(db); });

  async function states(): Promise<Record<string, string>> {
    const result = await db.execute<{ key: string; tgenabled: string }>(sql`
      select c.relname || '.' || t.tgname as key, t.tgenabled
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
    `);
    return Object.fromEntries(result.rows.map((r) => [r.key, r.tgenabled]));
  }

  it("the list names every user trigger the migrations create", async () => {
    const actual = Object.keys(await states()).sort();
    expect(GUARD_TRIGGERS.map((g) => `${g.table}.${g.trigger}`).sort()).toEqual(actual);
    expect(actual).toHaveLength(12);
  });

  it("after migrate every guard trigger has tgenabled = 'A'", async () => {
    const all = await states();
    for (const g of GUARD_TRIGGERS) expect(all[`${g.table}.${g.trigger}`], `${g.table}.${g.trigger}`).toBe("A");
  });

  it("DISABLE then ENABLE TRIGGER USER downgrades them, and rearmGuardTriggers restores 'A'", async () => {
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
    expect((await states())["audit_events.audit_events_no_update"]).toBe("O");
    await rearmGuardTriggers(db, ["audit_events"]);
    const all = await states();
    for (const g of GUARD_TRIGGERS) expect(all[`${g.table}.${g.trigger}`]).toBe("A");
  });

  it("a guard still fires under session_replication_role = replica", async () => {
    await db.insert(initiatives).values({
      id: "init-a", slug: "always", title: "Always", requester: "Priya Raman",
      state: "in_review", createdAt: now, updatedAt: now,
    });
    await db.insert(auditEvents).values({
      id: "ae-a", initiativeId: "init-a", ts: now, actor: "priya-raman", actorRole: "requester",
      action: "intake.created", detail: "must survive",
    });
    await db.execute(sql`SET session_replication_role = replica`);
    await expect(db.execute(sql`UPDATE audit_events SET detail = 'x'`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/) },
    });
    await expect(db.execute(sql`DELETE FROM audit_events`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/) },
    });
    await expect(db.execute(sql`TRUNCATE audit_events`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/TRUNCATE is not permitted/) },
    });
    await db.execute(sql`SET session_replication_role = origin`);
  });
});
