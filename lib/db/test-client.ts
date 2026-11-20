// Test-only DB helper — ALWAYS an in-memory PGlite instance holding the
// schema produced by the real migrations under drizzle/. Never touches
// DATABASE_URL, never writes to the persistent .pglite/ dev store, so tests
// are hermetic and can run fully in parallel/CI without any external service.
// The migrations run once per test file into a snapshot; every createTestDb()
// call starts a fresh, isolated instance from that snapshot (booting PGlite
// from a snapshot is far cheaper than a cold boot plus migrations).
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDb = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

// Snapshot of a freshly migrated database, built on first use. It is never
// handed out: each createTestDb() call loads its own copy.
let snapshot: Promise<Blob> | undefined;

async function buildSnapshot(): Promise<Blob> {
  const client = new PGlite(); // in-memory — no dataDir argument
  try {
    await migrate(drizzle({ client, schema }), { migrationsFolder: "./drizzle" });
    return await client.dumpDataDir("none");
  } finally {
    await client.close();
  }
}

/**
 * Creates a brand-new in-memory PGlite database holding every migration under
 * drizzle/ (including the hand-written registry view + append-only trigger
 * migrations), and returns the Drizzle handle. Every call returns its own
 * isolated database. Call `close()` when done.
 */
export async function createTestDb(): Promise<TestDb> {
  const pending = (snapshot ??= buildSnapshot());
  let loadDataDir: Blob;
  try {
    loadDataDir = await pending;
  } catch (err) {
    if (snapshot === pending) snapshot = undefined; // retry on the next call
    throw err;
  }
  const client = new PGlite({ loadDataDir });
  return drizzle({ client, schema }) as TestDb;
}

export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}

/**
 * Empty the tables the installation-stamp suites write (installation,
 * sessions, initiatives) so one migrated database can serve a whole file.
 * Booting PGlite and replaying every migration costs more than the cases
 * themselves. Only for suites that add no rows under initiatives; the
 * installation trigger is bypassed with the same DISABLE TRIGGER USER that
 * scripts/seed.ts uses for its maintenance wipe, then re-armed.
 */
export async function clearInstallationFixtures(db: TestDb): Promise<void> {
  await db.execute(sql`ALTER TABLE installation DISABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM installation`);
  await db.execute(sql`ALTER TABLE installation ENABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM sessions`);
  await db.execute(sql`DELETE FROM initiatives`);
}
