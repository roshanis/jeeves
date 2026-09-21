// DB client factory. Runtime URLs resolve from DATABASE_URL or Vercel's
// POSTGRES_URL alias. Neon hosts use Neon's WebSocket driver; other
// PostgreSQL hosts use node-postgres with bounded pool and Supabase TLS
// settings. Local development without a URL uses persistent PGlite, while
// Vercel fails closed rather than attempting an on-disk database. Tests use
// fresh in-memory PGlite instances through lib/db/test-client.ts.
import { neonConfig, Pool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { postgresPoolConfig } from "./connection-config";
import { assertRuntimeDatabaseConfigured, runtimeDatabaseUrl } from "./runtime-config";
import ws from "ws";
import * as schema from "./schema";
import { selectDriver } from "./driver-select";
import type { DbDriver } from "./driver-select";

export type Db =
  | NeonDatabase<typeof schema>
  | NodePgDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

/**
 * Resolve the persistent PGlite directory. Local development keeps the
 * historical repo-local default; isolated runners can point at a disposable
 * directory without changing DATABASE_URL or touching ./.pglite.
 */
export function localPgliteDirectory(): string {
  const override = process.env.JEEVES_PGLITE_DIR?.trim();
  return override || "./.pglite";
}

// Cache on globalThis, not at module scope: Next.js dev/Turbopack creates
// MULTIPLE server module graphs in one process, and a per-module cache gave
// each graph its own PGlite instance over the same ./.pglite directory —
// point-in-time snapshots diverged (page renders couldn't see rows written
// via API routes) and concurrent access corrupted the store once. One
// process-wide handle fixes coherence for the single-instance demo.
const DB_CACHE_KEY = Symbol.for("jeeves.db.cachedDb");
type DbCacheSlot = { db: Db | null; pool: Pool | null; pgPool: PgPool | null };
const dbSlot: DbCacheSlot = ((globalThis as Record<symbol, unknown>)[
  DB_CACHE_KEY
] ??= { db: null, pool: null, pgPool: null }) as DbCacheSlot;
const handleDrivers = new WeakMap<object, DbDriver>();

/** Driver recorded at construction so operations can follow the actual handle. */
export function getDbDriverForHandle(db: Db): DbDriver | undefined {
  return handleDrivers.get(db);
}

/**
 * Returns the process-wide DB handle, creating it on first use. Safe to
 * call repeatedly (e.g. from multiple route handlers) — the underlying
 * connection/instance is memoized on globalThis (see above).
 */
export function getDb(): Db {
  const databaseUrl = runtimeDatabaseUrl();
  assertRuntimeDatabaseConfigured(databaseUrl, process.env.VERCEL);
  if (dbSlot.db) {
    return dbSlot.db;
  }
  // See ./driver-select.ts: the Neon serverless driver speaks to Neon's
  // WebSocket proxy, NOT the Postgres wire protocol, so it cannot be used
  // for a plain Postgres server (a container sidecar, RDS, a local install).
  // Pointing it at one fails with `connect ECONNREFUSED <host>:443` — it
  // ignores the port in the URL entirely.
  const driver = selectDriver(databaseUrl, process.env.JEEVES_DB_DRIVER);

  if (driver === "neon") {
    neonConfig.webSocketConstructor = ws;
    dbSlot.pool ??= new Pool({ connectionString: databaseUrl });
    dbSlot.db = drizzleNeon({ client: dbSlot.pool, schema });
    handleDrivers.set(dbSlot.db, "neon");
    return dbSlot.db;
  }

  if (driver === "pg") {
    // node-postgres: a real connection pool over the wire protocol. This is
    // the right driver for any long-lived process (a container), and the only
    // one that works against a non-Neon server.
    dbSlot.pgPool ??= new PgPool(postgresPoolConfig(databaseUrl!, process.env.DATABASE_SSL_CA));
    dbSlot.db = drizzleNodePg({ client: dbSlot.pgPool, schema });
    handleDrivers.set(dbSlot.db, "pg");
    return dbSlot.db;
  }

  // No DATABASE_URL: local persistent PGlite store, not a network call.
  const client = new PGlite(localPgliteDirectory());
  dbSlot.db = drizzlePglite({ client, schema });
  handleDrivers.set(dbSlot.db, "pglite");
  return dbSlot.db;
}

/** Test-only: reset the memoized handle (used by test-client.ts between suites). */
export function resetDbForTests(): void {
  dbSlot.db = null;
}

/**
 * Close the underlying connection and drop the memoized handle. Needed by
 * short-lived CLI processes (scripts/seed.ts): the PGlite WASM runtime
 * otherwise keeps the Node event loop alive after the work is done. The
 * Neon WebSocket pool must likewise be ended by short-lived processes.
 */
export async function closeDb(): Promise<void> {
  if (!dbSlot.db && !dbSlot.pool && !dbSlot.pgPool) return;

  if (dbSlot.pool) {
    await dbSlot.pool.end();
    dbSlot.pool = null;
    dbSlot.db = null;
    return;
  }

  // node-postgres keeps its sockets open, so a CLI (scripts/migrate.ts,
  // scripts/seed.ts) would hang on exit without this.
  if (dbSlot.pgPool) {
    await dbSlot.pgPool.end();
    dbSlot.pgPool = null;
    dbSlot.db = null;
    return;
  }

  const client = (dbSlot.db as { $client?: { close?: () => Promise<void> } }).$client;
  if (client && typeof client.close === "function") {
    await client.close();
  }
  dbSlot.db = null;
}
