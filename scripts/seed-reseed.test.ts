// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../lib/db/test-client";
import { auditEvents, initiatives, reviewCycles, reviewDecisions, reviewNotifications } from "../lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../lib/intake/champion-prefill";
import type { Actor } from "../lib/domain/types";
import { seedDatabase } from "./seed";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const svc = await import("../lib/services/initiative-service");

const REQUESTER: Actor = { id: "priya-raman", role: "requester" };
const PROGRAM: Actor = { id: "nia-okafor", role: "program" };
const SYSTEM: Actor = { id: "system", role: "system" };

/**
 * Reseeding a database that has seen live traffic.
 *
 * `npm run reset:demo` exists to return a hosted demo to its canonical state
 * "clearing any live-created data". The live path writes tables the seed's own
 * wipe has to know about; review_notifications (0013) references both
 * initiatives and review_cycles, so a wipe that forgot it failed on the first
 * foreign key the moment a visitor's initiative reached triage.
 */
describe("scripts/seed.ts — reseed over live state", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(testDb);
  });

  async function liveTriage(): Promise<string> {
    const draft = await svc.createDraft(testDb, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: REQUESTER,
      requesterName: "Priya Raman",
      workspaceId: null,
    });
    await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, null);
    await svc.startQc(testDb, draft.initiativeId, PROGRAM, null);
    const res = await svc.triage(testDb, draft.initiativeId, SYSTEM, null);
    expect(res.branch).toBe("review");
    return draft.initiativeId;
  }

  it("succeeds after a live triage created review notifications", async () => {
    await seedDatabase(testDb);
    const liveId = await liveTriage();
    // Precondition: the live run really did queue asks that reference the
    // live initiative and its review cycle.
    expect((await testDb.select().from(reviewNotifications)).length).toBeGreaterThan(0);

    await expect(seedDatabase(testDb)).resolves.toBeDefined();

    // Everything live is gone, including the notification rows...
    expect(await testDb.select().from(reviewNotifications)).toHaveLength(0);
    const ids = (await testDb.select({ id: initiatives.id }).from(initiatives)).map((r) => r.id);
    expect(ids).not.toContain(liveId);
    expect(ids).toHaveLength(12);
    // ...and nothing orphaned points at a wiped cycle.
    const cycleIds = new Set((await testDb.select({ id: reviewCycles.id }).from(reviewCycles)).map((r) => r.id));
    for (const d of await testDb.select({ cycleId: reviewDecisions.cycleId }).from(reviewDecisions)) {
      expect(cycleIds.has(d.cycleId)).toBe(true);
    }
  });

  it("leaves every append-only trigger enabled afterwards", async () => {
    await seedDatabase(testDb);
    await liveTriage();
    await seedDatabase(testDb);

    // tgenabled 'O' = fires in origin/local mode, i.e. enabled.
    const result = await testDb.execute<{ tgname: string; tgenabled: string }>(sql`
      select t.tgname, t.tgenabled
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'audit_events' and not t.tgisinternal
    `);
    expect(result.rows.map((r) => r.tgname).sort()).toEqual([
      "audit_events_no_delete",
      "audit_events_no_truncate",
      "audit_events_no_update",
    ]);
    for (const row of result.rows) expect(row.tgenabled, row.tgname).toBe("O");

    await expect(testDb.delete(auditEvents)).rejects.toThrow();
    await expect(testDb.execute(sql`TRUNCATE audit_events`)).rejects.toThrow();
  });

  it("runs as a non-superuser table owner, as on RDS", async () => {
    // RDS's master user is not a superuser. `DISABLE TRIGGER ALL` also
    // disables the internal foreign-key triggers, which Postgres reserves for
    // superusers ("... is a system trigger"); `DISABLE TRIGGER USER` is enough
    // to get past the append-only guards and needs only table ownership.
    await testDb.execute(sql`CREATE ROLE seed_owner NOSUPERUSER LOGIN`);
    const tables = await testDb.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    for (const t of tables.rows) {
      await testDb.execute(sql.raw(`ALTER TABLE "${t.tablename}" OWNER TO seed_owner`));
    }
    await testDb.execute(sql`SET ROLE seed_owner`);
    try {
      const who = await testDb.execute<{ rolsuper: boolean }>(
        sql`select rolsuper from pg_roles where rolname = current_user`,
      );
      expect(who.rows[0]!.rolsuper).toBe(false);

      await seedDatabase(testDb);
      // A second run has audit rows to wipe, which is where the guard bites.
      await expect(seedDatabase(testDb)).resolves.toBeDefined();
    } finally {
      await testDb.execute(sql`RESET ROLE`);
    }
    expect(await testDb.select().from(initiatives)).toHaveLength(12);
  });
});
