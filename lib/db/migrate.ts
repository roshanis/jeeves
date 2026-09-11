// Non-destructive migration runner.
//
// Why this module exists: until it did, the ONLY place `migrate()` was
// called from outside the test harness was `scripts/seed.ts` — and that
// script wipes every table before reseeding, including a
// `DISABLE TRIGGER ALL` on `audit_events` so it can delete the append-only
// audit log. Applying a schema change to a live deployment therefore meant
// destroying the compliance record the product exists to keep. There was no
// migrate-only path at all.
//
// `applyMigrations()` is that path: it runs the same drizzle migrations
// under drizzle/ and touches nothing else. `scripts/seed.ts` now calls it
// too, so the two can never drift in which migrator they select.
//
// Driver selection mirrors `getDb()` in ./client.ts exactly — both key off
// DATABASE_URL, so the migrator always matches the handle it is given.
// Drizzle's migrations journal table makes either path idempotent.
import type { Db } from "./client";

/** Folder holding the drizzle-generated + hand-written migrations. */
export const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Applies every pending migration to `db`. Idempotent, and non-destructive:
 * it never deletes rows and never leaves the `audit_events` append-only
 * triggers disabled.
 */
export async function applyMigrations(db: Db): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    type NeonDb = Parameters<typeof migrate>[0];
    await migrate(db as NeonDb, { migrationsFolder: MIGRATIONS_FOLDER });
    return;
  }

  const { migrate } = await import("drizzle-orm/pglite/migrator");
  type PgliteDb = Parameters<typeof migrate>[0];
  await migrate(db as PgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * A human-readable description of what a migration run will target, safe to
 * print to a terminal or a CI log.
 *
 * A Postgres connection string carries a password (and a username that may
 * itself be sensitive), so this deliberately reconstructs the label from the
 * parsed host and database name only — it never echoes the input. An
 * unparseable value is reported opaquely rather than printed, because a
 * string we failed to parse may still contain a credential.
 */
export function describeMigrationTarget(databaseUrl: string | undefined): string {
  if (!databaseUrl) return "local PGlite store (./.pglite)";

  try {
    const { hostname, pathname } = new URL(databaseUrl);
    if (!hostname) return "Postgres (DATABASE_URL set, host unparseable)";
    const database = pathname.replace(/^\//, "");
    const label = database ? `${hostname}/${database}` : hostname;
    return `Neon Postgres — ${label}`;
  } catch {
    return "Postgres (DATABASE_URL set, host unparseable)";
  }
}
