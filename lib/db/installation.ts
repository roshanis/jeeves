// Data access for the installation stamp (drizzle/0015_installation.sql).
//
// Read side only. The stamp is written by exactly two paths: the demo
// bootstrap (lib/demo/bootstrap.ts) and, in a later phase, the production
// install script. Nothing in the running app writes it.
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { installation } from "./schema";

/**
 * What the stamp helpers need from a database handle. A `Pick` (like SeedDb in
 * scripts/seed.ts) so a transaction handle works as well as the pool: the seed
 * stamps inside its own transaction.
 */
export type InstallationDb = Pick<Db, "select" | "insert" | "execute">;

export type InstallationStamp = typeof installation.$inferSelect;

/**
 * Whether migration 0015 has been applied. A database that lags the code is a
 * normal state during a rolling deploy, so "no table" is an answer, not an
 * error; the same `to_regclass` probe is used for migration 0011/0013.
 */
export async function installationTableExists(db: InstallationDb): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass('public.installation')::text AS relation`);
  const rows = (Array.isArray(result) ? result : result.rows) as { relation: string | null }[];
  return rows[0]?.relation != null;
}

/** The stamp, or null when the database has none (or has no installation table yet). */
export async function readInstallationStamp(db: InstallationDb): Promise<InstallationStamp | null> {
  if (!(await installationTableExists(db))) return null;
  const [row] = await db.select().from(installation).limit(1);
  return row ?? null;
}
