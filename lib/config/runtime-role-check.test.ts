// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { InstallationCheckError, verifyRuntimeRole } from "./installation-check";

/**
 * Production must not run as a role that can switch the audit guards off:
 * a superuser, or one that owns audit_events, installation or the evidence
 * tables (ownership is what DISABLE TRIGGER and DROP TRIGGER need).
 */
describe("verifyRuntimeRole", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.execute(sql`CREATE ROLE rt_app NOSUPERUSER NOINHERIT`);
    await db.execute(sql`CREATE ROLE rt_owner NOSUPERUSER`);
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO rt_app`);
  });
  afterAll(async () => { await closeTestDb(db); });
  afterEach(async () => {
    await db.execute(sql`RESET ROLE`);
    for (const t of ["audit_events", "installation", "evidence_documents", "evidence_packets", "evidence_assessments"]) {
      await db.execute(sql.raw(`ALTER TABLE ${t} OWNER TO postgres`));
    }
    await db.execute(sql`REVOKE rt_owner FROM rt_app`);
  });

  async function failure(): Promise<InstallationCheckError> {
    const err = await verifyRuntimeRole(db).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(InstallationCheckError);
    return err as InstallationCheckError;
  }

  it("refuses a superuser, and names the fix", async () => {
    const err = await failure();
    expect(err.code).toBe("owner_role");
    expect(err.message).toMatch(/superuser/);
    expect(err.message).toContain("DATABASE_MIGRATION_URL");
    expect(err.message).toContain("docs/deploy.md");
    expect(err.message).toMatch(/Refusing to start/);
  });

  it("refuses a non-superuser that owns an audit or evidence table, naming the tables", async () => {
    await db.execute(sql`ALTER TABLE audit_events OWNER TO rt_app`);
    await db.execute(sql`ALTER TABLE evidence_packets OWNER TO rt_app`);
    await db.execute(sql`SET ROLE rt_app`);
    const err = await failure();
    expect(err.code).toBe("owner_role");
    expect(err.message).toContain("audit_events");
    expect(err.message).toContain("evidence_packets");
    expect(err.message).not.toMatch(/superuser/);
  });

  it("refuses a role that inherits the owner's rights through membership", async () => {
    await db.execute(sql`ALTER TABLE installation OWNER TO rt_owner`);
    await db.execute(sql`CREATE ROLE rt_member NOSUPERUSER INHERIT IN ROLE rt_owner`);
    await db.execute(sql`SET ROLE rt_member`);
    const err = await failure();
    expect(err.message).toContain("installation");
  });

  it("accepts a role that is neither a superuser nor an owner", async () => {
    await db.execute(sql`SET ROLE rt_app`);
    await expect(verifyRuntimeRole(db)).resolves.toBeUndefined();
  });
});
