// DB client factory — plan.md §4 (Neon Postgres + Drizzle; no Docker) and
// the M1-P1 task brief: use @neondatabase/serverless when DATABASE_URL is
// set, otherwise fall back to a local PGlite instance so the app and tests
// run with zero external services and no sign-up.
//
// - Production / anywhere DATABASE_URL is set: drizzle-orm/neon-http over
//   @neondatabase/serverless's HTTP driver (no `ws` dependency required,
//   unlike the pool-based neon-serverless driver — keeps us to "NO other
//   new dependencies").
// - Local dev without DATABASE_URL: PGlite with a persistent on-disk store
//   at .pglite/ (gitignored) so `npm run dev` / `npm run db:seed` retain
//   data across restarts.
// - Tests: ALWAYS use a fresh in-memory PGlite instance (see
//   lib/db/test-client.ts) regardless of DATABASE_URL, so test runs never
//   depend on network access or shared local state.
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema> | PgliteDatabase<typeof schema>;

let cachedDb: Db | null = null;

/**
 * Returns the process-wide DB handle, creating it on first use. Safe to
 * call repeatedly (e.g. from multiple route handlers) — the underlying
 * connection/instance is memoized.
 */
export function getDb(): Db {
  if (cachedDb) {
    return cachedDb;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const sql = neon(databaseUrl);
    cachedDb = drizzleNeonHttp({ client: sql, schema });
    return cachedDb;
  }

  // No DATABASE_URL: local persistent PGlite store, not a network call.
  const client = new PGlite("./.pglite");
  cachedDb = drizzlePglite({ client, schema });
  return cachedDb;
}

/** Test-only: reset the memoized handle (used by test-client.ts between suites). */
export function resetDbForTests(): void {
  cachedDb = null;
}

/**
 * Close the underlying connection and drop the memoized handle. Needed by
 * short-lived CLI processes (scripts/seed.ts): the PGlite WASM runtime
 * otherwise keeps the Node event loop alive after the work is done. The
 * Neon HTTP driver is stateless — nothing to close there.
 */
export async function closeDb(): Promise<void> {
  if (!cachedDb) return;
  const client = (cachedDb as { $client?: { close?: () => Promise<void> } }).$client;
  if (client && typeof client.close === "function") {
    await client.close();
  }
  cachedDb = null;
}
