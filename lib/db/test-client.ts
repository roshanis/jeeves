// Test-only DB helper — ALWAYS an in-memory PGlite instance running the
// real migrations under drizzle/. Never touches DATABASE_URL, never writes
// to the persistent .pglite/ dev store, so tests are hermetic and can run
// fully in parallel/CI without any external service.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDb = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

/**
 * Creates a brand-new in-memory PGlite database, runs every migration under
 * drizzle/ (including the hand-written registry view + append-only trigger
 * migrations), and returns the Drizzle handle. Call `close()` when done.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite(); // in-memory — no dataDir argument
  const db = drizzle({ client, schema }) as TestDb;
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}
