// Apply the versioned migration journal without reseeding or deleting data.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { PGlite } from "@electric-sql/pglite";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import type { Db } from "./client";
import { createNeonPool, getDbDriverForHandle } from "./client";
import * as schema from "./schema";
import { selectDriver, type DbDriver } from "./driver-select";
import { migrationDatabaseUrl, migrationPoolConfig } from "./connection-config";
import { runtimeDatabaseUrl } from "./runtime-config";

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
 * forever. Compare what is applied with the journal, in order, and fail loudly.
 */
async function assertAppliedMatchesJournal(db: Db): Promise<void> {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as
    { entries: { tag: string; when: number }[] };
  const result = await (db as { execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }> })
    .execute(sql`select created_at from drizzle.__drizzle_migrations order by id`);
  const applied = result.rows.map((row) => Number(row.created_at));
  const length = Math.max(applied.length, journal.entries.length);
  for (let i = 0; i < length; i++) {
    if (applied[i] !== journal.entries[i]?.when) {
      throw new Error(
        `Applied migrations diverge from the journal at position ${i} (${journal.entries[i]?.tag ?? "no journal entry"}): ` +
        `${applied.length} applied, ${journal.entries.length} in the journal. A migration was skipped or the journal changed; do not continue.`,
      );
    }
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
  await assertAppliedMatchesJournal(db);
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

  let pool: Pool | NeonPool;
  if (driver === "neon") {
    neonConfig.webSocketConstructor = ws;
    pool = createNeonPool(url!);
    try {
      await applyMigrations(drizzleNeon({ client: pool as NeonPool, schema }), "neon", url);
    } finally {
      await pool.end();
    }
  } else {
    pool = new Pool(migrationPoolConfig(url!, process.env.DATABASE_SSL_CA));
    pool.on("error", () => console.error("PostgreSQL migration connection error."));
    try {
      await applyMigrations(drizzleNodePg({ client: pool as Pool, schema }), "pg", url);
    } finally {
      await pool.end();
    }
  }
}

/** A safe label that never prints connection details or credentials. */
export function describeMigrationTarget(databaseUrl: string | undefined): string {
  return databaseUrl ? "Postgres (configured migration connection)" : "local PGlite store (./.pglite)";
}
