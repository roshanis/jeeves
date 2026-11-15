// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { applyMigrations } from "./migrate";
import * as schema from "./schema";

/**
 * Upgrade tests: migrate a database to an OLDER point of the journal (a copy
 * of ./drizzle whose journal is cut after `keep` entries), put rows in it, then
 * apply the real, current journal on top. migrate.test.ts only ever migrates an
 * empty database.
 */
const tempFolders: string[] = [];
function olderMigrationsFolder(keep: number): string {
  const dir = mkdtempSync(join(tmpdir(), "jeeves-migrations-"));
  tempFolders.push(dir);
  cpSync("./drizzle", dir, { recursive: true });
  const path = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, keep);
  writeFileSync(path, JSON.stringify(journal));
  return dir;
}

const insertInitiative = (db: ReturnType<typeof drizzle>, id: string) =>
  db.execute(sql`insert into initiatives (id, slug, title, requester, state, created_at, updated_at)
    values (${id}, ${id}, 't', 'r', 'draft', now(), now())`);

describe("lib/db/migrate — upgrading a populated database", () => {
  const open: PGlite[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close()));
    for (const dir of tempFolders.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function dbAt(keep: number) {
    const client = new PGlite();
    open.push(client);
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: olderMigrationsFolder(keep) });
    return db;
  }

  it("keeps existing rows when the remaining migrations are applied", async () => {
    const db = await dbAt(6); // 0000..0005
    await insertInitiative(db, "init-1");
    await applyMigrations(db as never, "pglite");
    const rows = await db.execute(sql`select id, workspace_id from initiatives`);
    expect(rows.rows).toEqual([{ id: "init-1", workspace_id: null }]);
    const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
    const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0]).toEqual({ n: journal.entries.length });
  });

  it("fails with a clear duplicate-key error and leaves the data intact when rows violate a new unique index", async () => {
    const db = await dbAt(6); // 0006 adds initiative_decisions_cycle_uq
    await db.execute(sql`set session_replication_role = replica`);
    for (const id of ["d1", "d2"]) {
      await db.execute(sql`insert into initiative_decisions (id, initiative_id, cycle_id, type, approver, decided_at)
        values (${id}, 'i', 'same-cycle', 'approved', 'a', now())`);
    }
    await db.execute(sql`set session_replication_role = origin`);
    await expect(applyMigrations(db as never, "pglite")).rejects.toThrow(/initiative_decisions_cycle_uq|duplicate key/);
    const rows = await db.execute(sql`select id from initiative_decisions order by id`);
    expect(rows.rows).toEqual([{ id: "d1" }, { id: "d2" }]);
    const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0]).toEqual({ n: 6 });
  });
});
