// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { clearInstallationFixtures, createTestDb, closeTestDb, type TestDb } from "./test-client";
import { installation } from "./schema";
import { installationTableExists, readInstallationStamp } from "./installation";

/**
 * Migration 0015 — the installation stamp.
 *
 * One row says what kind of installation a database is ('demo' or
 * 'production') and which install it is. The boot check refuses a process
 * whose JEEVES_MODE disagrees with the stamp, so the stamp must be impossible
 * to rewrite or erase once written: a demo-mode process pointed at a
 * production database (or the reverse) is caught only for as long as the row
 * says what it said the day it was written.
 */
describe("migration 0015 — installation stamp", () => {
  let db: TestDb;

  // drizzle wraps driver errors ("Failed query: ..."); the message the trigger
  // or constraint raised is on `cause`.
  async function expectRejected(statement: string, message: RegExp): Promise<void> {
    await expect(db.execute(sql.raw(statement))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(message) },
    });
  }

  // One migrated database for the file; each case starts from an empty table.
  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await clearInstallationFixtures(db);
  });

  it("creates the table with the specified columns", async () => {
    const result = await db.execute<{ column_name: string; data_type: string; is_nullable: string }>(sql`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'installation' order by column_name
    `);
    expect(result.rows).toEqual([
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "deploy_mode", data_type: "text", is_nullable: "NO" },
      { column_name: "id", data_type: "boolean", is_nullable: "NO" },
      { column_name: "install_id", data_type: "text", is_nullable: "NO" },
      { column_name: "org_workspace_id", data_type: "text", is_nullable: "YES" },
      { column_name: "reference_seed_version", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("starts empty and reports the table as present", async () => {
    expect(await installationTableExists(db)).toBe(true);
    expect(await readInstallationStamp(db)).toBeNull();
  });

  it("stores a stamp with a true id and a creation time by default", async () => {
    await db.insert(installation).values({ deployMode: "demo", installId: "inst-1" });
    const stamp = await readInstallationStamp(db);
    expect(stamp).toMatchObject({
      id: true,
      deployMode: "demo",
      installId: "inst-1",
      orgWorkspaceId: null,
      referenceSeedVersion: null,
    });
    expect(stamp?.createdAt).toBeInstanceOf(Date);
  });

  describe("constraints", () => {
    it("is a singleton: a second row is rejected", async () => {
      await db.insert(installation).values({ deployMode: "demo", installId: "inst-1" });
      await expectRejected(
        `INSERT INTO installation (deploy_mode, install_id) VALUES ('production', 'inst-2')`,
        /duplicate key|installation_pkey/,
      );
    });

    it("refuses an id other than true", async () => {
      await expectRejected(
        `INSERT INTO installation (id, deploy_mode, install_id) VALUES (false, 'demo', 'inst-1')`,
        /installation_singleton/,
      );
    });

    it.each(["staging", "Demo", "PRODUCTION", ""])("refuses deploy_mode %j", async (mode) => {
      await expectRejected(
        `INSERT INTO installation (deploy_mode, install_id) VALUES ('${mode}', 'inst-1')`,
        /installation_deploy_mode_check/,
      );
    });

    it("requires a deploy_mode and an install_id", async () => {
      await expectRejected(`INSERT INTO installation (install_id) VALUES ('inst-1')`, /null value|not-null/);
      await expectRejected(`INSERT INTO installation (deploy_mode) VALUES ('demo')`, /null value|not-null/);
    });
  });

  describe("immutability trigger", () => {
    beforeEach(async () => {
      await db.insert(installation).values({ deployMode: "demo", installId: "inst-1" });
    });

    it("refuses to change deploy_mode, in either direction", async () => {
      await expectRejected(`UPDATE installation SET deploy_mode = 'production'`, /deploy_mode is immutable/);
      expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
    });

    it("refuses to change deploy_mode away from production", async () => {
      await db.execute(sql`ALTER TABLE installation DISABLE TRIGGER USER`);
      await db.execute(sql`UPDATE installation SET deploy_mode = 'production'`);
      await db.execute(sql`ALTER TABLE installation ENABLE TRIGGER USER`);
      await expectRejected(`UPDATE installation SET deploy_mode = 'demo'`, /deploy_mode is immutable/);
      expect((await readInstallationStamp(db))?.deployMode).toBe("production");
    });

    it("refuses to change install_id", async () => {
      await expectRejected(`UPDATE installation SET install_id = 'inst-2'`, /install_id is immutable/);
      expect((await readInstallationStamp(db))?.installId).toBe("inst-1");
    });

    it("allows an UPDATE that leaves deploy_mode and install_id as they are", async () => {
      await db.execute(sql`UPDATE installation SET deploy_mode = 'demo', install_id = 'inst-1'`);
      await db.execute(
        sql`UPDATE installation SET org_workspace_id = 'org-acme', reference_seed_version = 'starter-1'`,
      );
      expect(await readInstallationStamp(db)).toMatchObject({
        deployMode: "demo",
        installId: "inst-1",
        orgWorkspaceId: "org-acme",
        referenceSeedVersion: "starter-1",
      });
    });

    it("blocks DELETE", async () => {
      await expectRejected(`DELETE FROM installation`, /DELETE is not permitted/);
      expect(await readInstallationStamp(db)).not.toBeNull();
    });

    it.each(["TRUNCATE installation", "TRUNCATE installation CASCADE", "TRUNCATE installation RESTART IDENTITY"])(
      "blocks `%s`",
      async (statement) => {
        await expectRejected(statement, /TRUNCATE is not permitted/);
        expect(await readInstallationStamp(db)).not.toBeNull();
      },
    );

    it("blocks TRUNCATE even on an empty table", async () => {
      await db.execute(sql`ALTER TABLE installation DISABLE TRIGGER USER`);
      await db.execute(sql`DELETE FROM installation`);
      await db.execute(sql`ALTER TABLE installation ENABLE TRIGGER USER`);
      await expectRejected(`TRUNCATE installation`, /TRUNCATE is not permitted/);
    });

    it("leaves ON CONFLICT DO NOTHING working, since it never reaches the UPDATE trigger", async () => {
      const inserted = await db
        .insert(installation)
        .values({ deployMode: "production", installId: "inst-9" })
        .onConflictDoNothing({ target: installation.id })
        .returning({ id: installation.id });
      expect(inserted).toEqual([]);
      expect(await readInstallationStamp(db)).toMatchObject({ deployMode: "demo", installId: "inst-1" });
    });
  });

  // Boots its own database (the one that lags the code): a PGlite boot plus every
  // migration inside the test, which the 5 s default does not cover on a loaded
  // machine; hooks already get 30 s from vitest.config.ts.
  it("reports a missing table without throwing", async () => {
    const lagging = await createTestDb();
    try {
      await lagging.execute(sql`DROP TABLE installation`);
      expect(await installationTableExists(lagging)).toBe(false);
      expect(await readInstallationStamp(lagging)).toBeNull();
    } finally {
      await closeTestDb(lagging);
    }
  }, 30_000);
});
