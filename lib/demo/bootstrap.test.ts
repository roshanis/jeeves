// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { clearInstallationFixtures, createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { applyMigrations } from "../db/migrate";
import {
  auditEvents,
  evidenceDocuments,
  evidencePackets,
  initiatives,
  installation,
  intakeVersions,
  reviewCycles,
  riskAssessments,
  sessions,
} from "../db/schema";
import { installationTableExists, readInstallationStamp } from "../db/installation";
import { verifyInstallation } from "../config/installation-check";
import { seedDatabase } from "../../scripts/seed";
import { assertDemoDatabase, ensureDemoInstallation, refuseProductionDatabase } from "./bootstrap";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stamp 'production' the way the P4 install script will: a plain insert. */
async function stampProduction(db: TestDb): Promise<void> {
  await db.insert(installation).values({ deployMode: "production", installId: "inst-prod-1" });
}

describe("lib/demo/bootstrap — ensureDemoInstallation", () => {
  let db: TestDb;

  // One migrated database for the describe; each case starts from an empty table.
  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await clearInstallationFixtures(db);
  });

  it("stamps 'demo' on a database that has no stamp", async () => {
    const result = await ensureDemoInstallation(db);
    expect(result).toEqual({ stamped: true, deployMode: "demo" });

    const stamp = await readInstallationStamp(db);
    expect(stamp).toMatchObject({
      deployMode: "demo",
      orgWorkspaceId: null,
      referenceSeedVersion: null,
    });
    expect(stamp?.installId).toMatch(UUID);
  });

  it("is idempotent: later calls change nothing", async () => {
    await ensureDemoInstallation(db);
    const first = await readInstallationStamp(db);

    for (let i = 0; i < 3; i++) {
      expect(await ensureDemoInstallation(db)).toEqual({ stamped: false, deployMode: "demo" });
    }
    expect(await readInstallationStamp(db)).toEqual(first);
    expect((await db.select({ n: count() }).from(installation))[0].n).toBe(1);
  });

  it("leaves exactly one stamp when several instances boot at once", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => ensureDemoInstallation(db)));
    expect(results.filter((r) => r.stamped)).toHaveLength(1);
    expect(results.every((r) => r.deployMode === "demo")).toBe(true);
    expect((await db.select({ n: count() }).from(installation))[0].n).toBe(1);
  });

  it("never overwrites a production stamp", async () => {
    await stampProduction(db);
    const before = await readInstallationStamp(db);

    expect(await ensureDemoInstallation(db)).toEqual({ stamped: false, deployMode: "production" });
    expect(await readInstallationStamp(db)).toEqual(before);
    expect((await readInstallationStamp(db))?.deployMode).toBe("production");
  });

  it("does not touch the org workspace or reference seed version of an existing stamp", async () => {
    await ensureDemoInstallation(db);
    await db.update(installation).set({ orgWorkspaceId: "org-x", referenceSeedVersion: "v1" });
    await ensureDemoInstallation(db);
    expect(await readInstallationStamp(db)).toMatchObject({ orgWorkspaceId: "org-x", referenceSeedVersion: "v1" });
  });

  it("works inside a transaction, so the seed can stamp in the same unit of work", async () => {
    await db.transaction(async (tx) => {
      expect(await ensureDemoInstallation(tx)).toMatchObject({ stamped: true });
    });
    expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
  });
});

/**
 * The live demo database cannot be reseeded once evidence exists
 * (seedDatabase throws "Refusing reset to preserve evidence history"), and a
 * reseed would wipe visitors' work anyway. So the stamp has to arrive on a
 * database that is already populated: migrate it, then bootstrap, with no
 * reseed in between.
 *
 * The populated database is built by seeding, adding the rows a live demo
 * accumulates (a visitor's initiative with an evidence packet, evidence bytes,
 * audit rows, sessions), and then winding migration 0015 back off so the
 * state is exactly "everything up to 0014, with data". applyMigrations() is
 * then the real journal-driven upgrade.
 */
describe("lib/demo/bootstrap — against an already-populated demo database", () => {
  let db: TestDb;
  const now = new Date("2026-07-01T00:00:00Z");

  async function addLiveEvidence(): Promise<void> {
    await db.insert(initiatives).values({
      id: "live-1",
      slug: "live-visitor-initiative",
      title: "Visitor initiative",
      requester: "Priya Raman",
      state: "in_review",
      createdAt: now,
      updatedAt: now,
      workspaceId: "ws_visitor",
    });
    await db.insert(intakeVersions).values({
      id: "live-iv",
      initiativeId: "live-1",
      version: 1,
      fields: {},
      missing: [],
      createdAt: now,
    });
    await db.insert(riskAssessments).values({
      id: "live-risk",
      initiativeId: "live-1",
      intakeVersionId: "live-iv",
      version: 1,
      tier: "high",
      flags: {},
      requiredDomains: ["privacy-hipaa"],
      createdAt: now,
    });
    await db.insert(reviewCycles).values({
      id: "live-cycle",
      initiativeId: "live-1",
      riskAssessmentId: "live-risk",
      kind: "initial",
      openedAt: now,
    });
    await db.insert(evidencePackets).values({
      id: "live-packet",
      initiativeId: "live-1",
      cycleId: "live-cycle",
      version: 1,
      revision: 1,
      status: "draft",
      entries: [],
      createdAt: now,
    });
    const content = Buffer.from("evidence bytes that must survive");
    await db.insert(evidenceDocuments).values({
      id: "live-doc",
      initiativeId: "live-1",
      requestId: "req-1",
      fileName: "attestation.pdf",
      mediaType: "application/pdf",
      byteSize: content.length,
      sha256: "0".repeat(64),
      content,
      version: 1,
      uploadedBy: "priya-raman",
      createdAt: now,
    });
    await db.insert(auditEvents).values({
      id: "live-audit",
      initiativeId: "live-1",
      ts: now,
      actor: "priya-raman",
      actorRole: "requester",
      action: "evidence.uploaded",
      detail: "must survive the bootstrap",
    });
    await db.insert(sessions).values({
      token: "tok-visitor",
      personaKey: "priya-raman",
      workspaceId: "ws_visitor",
      expiresAt: now.getTime() + 3_600_000,
    });
  }

  /** Put the database back to its pre-0015 state without touching any data. */
  async function windBackMigration0015(): Promise<void> {
    await db.execute(sql`DROP TABLE installation`);
    await db.execute(sql`DROP FUNCTION installation_guard()`);
    await db.execute(sql`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
    `);
  }

  async function snapshot() {
    const [audit] = await db.select({ n: count() }).from(auditEvents);
    const [docs] = await db.select({ n: count() }).from(evidenceDocuments);
    const [packets] = await db.select({ n: count() }).from(evidencePackets);
    const [inits] = await db.select({ n: count() }).from(initiatives);
    const [sess] = await db.select({ n: count() }).from(sessions);
    return { audit: audit.n, docs: docs.n, packets: packets.n, inits: inits.n, sess: sess.n };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await seedDatabase(db);
    await addLiveEvidence();
    // The reason a reseed is not an option once a visitor has attached evidence.
    await expect(seedDatabase(db)).rejects.toThrow(/preserve evidence history/);
    await windBackMigration0015();
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  it("applies migration 0015 and stamps 'demo' with no reseed and no data loss, idempotently", async () => {
    // Precondition: populated, with evidence, and no installation table.
    const before = await snapshot();
    expect(before.audit).toBeGreaterThan(100);
    expect(before.docs).toBe(1);
    expect(before.packets).toBe(1);
    expect(before.inits).toBe(13);
    expect(before.sess).toBe(1);
    expect(await installationTableExists(db)).toBe(false);

    // The upgrade: the real journal-driven migrator, then the bootstrap.
    await applyMigrations(db);
    expect(await installationTableExists(db)).toBe(true);
    expect(await ensureDemoInstallation(db)).toEqual({ stamped: true, deployMode: "demo" });

    // Nothing was reseeded, wiped or rewritten.
    expect(await snapshot()).toEqual(before);
    const [doc] = await db.select().from(evidenceDocuments).where(eq(evidenceDocuments.id, "live-doc"));
    expect(Buffer.from(doc.content).toString()).toBe("evidence bytes that must survive");
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.id, "live-audit"));
    expect(audit.detail).toBe("must survive the bootstrap");

    // The stamp is the demo's, and the boot check accepts it as it stands.
    const stamped = await readInstallationStamp(db);
    expect(stamped).toMatchObject({ deployMode: "demo" });
    await expect(verifyInstallation(db, "demo")).resolves.toBeUndefined();

    // Boot again, and again: migrate + bootstrap change nothing.
    await applyMigrations(db);
    expect(await ensureDemoInstallation(db)).toEqual({ stamped: false, deployMode: "demo" });
    await verifyInstallation(db, "demo");
    expect(await readInstallationStamp(db)).toEqual(stamped);
    expect(await snapshot()).toEqual(before);

    // The append-only guards are still armed.
    await expect(db.execute(sql`DELETE FROM audit_events`)).rejects.toBeDefined();
    await expect(db.execute(sql`TRUNCATE audit_events`)).rejects.toBeDefined();
    expect((await snapshot()).audit).toBe(before.audit);
  });
});

// A case that boots its own database (the one that lags the code) pays for a
// PGlite boot and every migration inside the test, which the 5 s default does
// not cover on a loaded machine; hooks already get 30 s from vitest.config.ts.
const LAGGING_DB_TIMEOUT_MS = 30_000;

describe("lib/demo/bootstrap — guards for the seed and reset scripts", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await clearInstallationFixtures(db);
  });

  /** A database that lags the code: migration 0015 never ran. */
  async function withoutInstallationTable(run: (lagging: TestDb) => Promise<void>): Promise<void> {
    const lagging = await createTestDb();
    try {
      await lagging.execute(sql`DROP TABLE installation`);
      await run(lagging);
    } finally {
      await closeTestDb(lagging);
    }
  }

  describe("assertDemoDatabase", () => {
    it("stamps an unstamped database and passes", async () => {
      await expect(assertDemoDatabase(db)).resolves.toBeUndefined();
      expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
    });

    it("passes on a demo-stamped database", async () => {
      await ensureDemoInstallation(db);
      await expect(assertDemoDatabase(db)).resolves.toBeUndefined();
    });

    it("refuses a production-stamped database and leaves the stamp alone", async () => {
      await stampProduction(db);
      await expect(assertDemoDatabase(db)).rejects.toThrow(/stamped "production"/);
      expect(await readInstallationStamp(db)).toMatchObject({ deployMode: "production", installId: "inst-prod-1" });
    });

    it("says what to do when migration 0015 has not been applied", async () => {
      await withoutInstallationTable(async (lagging) => {
        await expect(assertDemoDatabase(lagging)).rejects.toThrow(/db:migrate/);
      });
    }, LAGGING_DB_TIMEOUT_MS);
  });

  describe("refuseProductionDatabase (read-only, runs before the CLI migrates)", () => {
    it("passes when the installation table does not exist yet", async () => {
      await withoutInstallationTable(async (lagging) => {
        await expect(refuseProductionDatabase(lagging)).resolves.toBeUndefined();
      });
    }, LAGGING_DB_TIMEOUT_MS);

    it("passes on an unstamped database without stamping it", async () => {
      await expect(refuseProductionDatabase(db)).resolves.toBeUndefined();
      expect(await readInstallationStamp(db)).toBeNull();
    });

    it("passes on a demo-stamped database", async () => {
      await ensureDemoInstallation(db);
      await expect(refuseProductionDatabase(db)).resolves.toBeUndefined();
    });

    it("refuses a production-stamped database", async () => {
      await stampProduction(db);
      await expect(refuseProductionDatabase(db)).rejects.toThrow(/stamped "production"/);
    });
  });
});
