// Apply the versioned migration journal without reseeding or deleting data.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig, type PoolClient as NeonPoolClient } from "@neondatabase/serverless";
import ws from "ws";
import type { Db } from "./client";
import { createNeonPool, getDbDriverForHandle } from "./client";
import * as schema from "./schema";
import { normalizeHost, selectDriver, type DbDriver } from "./driver-select";
import { migrationDatabaseUrl, migrationPoolConfig } from "./connection-config";
import { runtimeDatabaseUrl } from "./runtime-config";
import { applyApiRoleLockdown } from "./api-role-lockdown";

export const MIGRATIONS_FOLDER = "./drizzle";

/** Infer from the supplied handle where possible, never merely from ambient test env. */
function driverForHandle(db: Db): DbDriver {
  const recorded = getDbDriverForHandle(db);
  if (recorded) return recorded;
  const client = (db as { $client?: unknown }).$client;
  if (client instanceof PGlite) return "pglite";
  return selectDriver(runtimeDatabaseUrl(), process.env.JEEVES_DB_DRIVER);
}

/**
 * drizzle runs an entry only if its `when` exceeds the newest applied one, so
 * a migration merged with an equal or lower `when` is skipped silently and
 * forever. After migrating, every journal entry must be recorded as applied;
 * fail loudly, naming the ones that are not.
 *
 * A database that is AHEAD of this build's journal is not an error here: that
 * is a rollback to an older build, nothing of this build's was skipped, and
 * refusing would make the older build's migrate step fail. It is reported.
 */
async function assertJournalApplied(db: Db): Promise<void> {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as
    { entries: { tag: string; when: number }[] };
  const result = await (db as { execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }> })
    .execute(sql`select created_at from drizzle.__drizzle_migrations`);
  const applied = new Set(result.rows.map((row) => Number(row.created_at)));

  const missing = journal.entries.filter((entry) => !applied.has(entry.when));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} ${missing.length === 1 ? "migration in the journal is" : "migrations in the journal are"} ` +
      `not applied to this database: ${missing.map((entry) => entry.tag).join(", ")}. ` +
      "drizzle only runs an entry that is newer than the newest applied one, so these will never run on their own; do not continue.",
    );
  }

  const known = new Set(journal.entries.map((entry) => entry.when));
  const unknown = [...applied].filter((when) => !known.has(when)).length;
  if (unknown > 0) {
    console.warn(
      `This database has ${unknown} applied ${unknown === 1 ? "migration" : "migrations"} that this build does not know: ` +
      "it was migrated by a newer build. Nothing was changed.",
    );
  }
}

/** Apply migrations using the driver that created the supplied Drizzle handle. */
export async function applyMigrations(
  db: Db,
  driver: DbDriver = driverForHandle(db),
  migrationConnectionUrl?: string,
): Promise<void> {
  // Calls against an existing runtime handle cannot switch to a separate URL.
  // Validate the actual handle URL, which prevents seed.ts from migrating
  // through Supabase transaction pooling even when a direct URL is configured.
  if (driver !== "pglite") {
    const effectiveUrl = migrationConnectionUrl ?? runtimeDatabaseUrl();
    if (effectiveUrl) migrationDatabaseUrl(effectiveUrl);
  }
  if (driver === "neon") {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } else if (driver === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  }
  await assertJournalApplied(db);
  // Covers tables later migrations add; a no-op without the Supabase API roles.
  await applyApiRoleLockdown(db as Parameters<typeof applyApiRoleLockdown>[0]);
}

/** Arbitrary constant key of the session advisory lock that serialises concurrent migrate runs. */
const MIGRATION_LOCK_KEY = 7_426_113_005;

/**
 * Check out ONE client, hold a session advisory lock on it and run `migrate`
 * through that same client, so overlapping `db:migrate` runs (two CI jobs, a
 * retried deploy hook) wait for each other instead of failing with "already
 * exists". Only for a session-capable connection: runMigrations skips it for a
 * Neon pooled endpoint (PgBouncer transaction mode), where the unlock can run
 * on a different server connection, return false and leave the original lock
 * held. On generic pg
 * hosts the migration pool's lock_timeout (DATABASE_MIGRATION_LOCK_TIMEOUT_MS,
 * default 10 s) also bounds the wait, so an overlapping run fails with 55P03
 * after that time instead of waiting indefinitely.
 */
async function withMigrationLock<C extends { query: (text: string) => Promise<unknown>; release: () => void }>(
  pool: { connect: () => Promise<C> },
  migrate: (client: C) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      await migrate(client);
    } finally {
      // A broken connection drops the session lock anyway; never mask the migrate error.
      await client.query(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Neon pooled endpoints (ep-...-pooler.*.neon.tech) run PgBouncer in transaction mode. */
function isNeonPooledUrl(url: string): boolean {
  try { return normalizeHost(new URL(url).hostname).includes("-pooler."); }
  catch { return false; }
}

/** Use a dedicated migration connection when configured; never borrow the runtime transaction pool. */
export async function runMigrations(): Promise<void> {
  const url = migrationDatabaseUrl(runtimeDatabaseUrl(), process.env.DATABASE_MIGRATION_URL);
  const driver = selectDriver(url, process.env.JEEVES_DB_DRIVER);
  if (driver === "pglite") {
    const { getDb, closeDb } = await import("./client");
    try { await applyMigrations(getDb(), "pglite"); }
    finally { await closeDb(); }
    return;
  }

  if (driver === "neon") {
    neonConfig.webSocketConstructor = ws;
    const pool = createNeonPool(url!);
    try {
      if (isNeonPooledUrl(url!)) {
        // No advisory lock through the pooler: it cannot serialise anything there.
        await applyMigrations(drizzleNeon({ client: pool, schema }), "neon", url);
      } else {
        await withMigrationLock<NeonPoolClient>(pool, (client) =>
          applyMigrations(drizzleNeon({ client, schema }), "neon", url));
      }
    } finally {
      await pool.end();
    }
  } else {
    const pool = new Pool(migrationPoolConfig(url!, process.env.DATABASE_SSL_CA));
    pool.on("error", () => console.error("PostgreSQL migration connection error."));
    try {
      await withMigrationLock<PoolClient>(pool, (client) =>
        applyMigrations(drizzleNodePg({ client, schema }), "pg", url));
    } finally {
      await pool.end();
    }
  }
}

/** A safe label that never prints connection details or credentials. */
export function describeMigrationTarget(databaseUrl: string | undefined): string {
  return databaseUrl ? "Postgres (configured migration connection)" : "local PGlite store (./.pglite)";
}
