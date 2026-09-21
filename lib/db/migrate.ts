// Apply the versioned migration journal without reseeding or deleting data.
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { PGlite } from "@electric-sql/pglite";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import type { Db } from "./client";
import { getDbDriverForHandle } from "./client";
import * as schema from "./schema";
import { selectDriver, type DbDriver } from "./driver-select";
import { migrationDatabaseUrl, postgresPoolConfig } from "./connection-config";
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
    pool = new NeonPool({ connectionString: url! });
    try {
      await applyMigrations(drizzleNeon({ client: pool as NeonPool, schema }), "neon", url);
    } finally {
      await pool.end();
    }
  } else {
    pool = new Pool({ ...postgresPoolConfig(url!, process.env.DATABASE_SSL_CA), max: 1 });
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
