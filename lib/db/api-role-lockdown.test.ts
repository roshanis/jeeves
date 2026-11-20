// @vitest-environment node
import { readFileSync } from "node:fs";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type AnyPgTable } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { API_LOCKDOWN_TABLES, applyApiRoleLockdown } from "./api-role-lockdown";
import * as schema from "./schema";

/**
 * Supabase hands its API roles (anon, authenticated) default grants on every
 * table created in public. Migration 0016 and the post-migrate step revoke
 * them and enable RLS, and do nothing on a database without both roles.
 */
const schemaTableNames = (Object.values(schema).filter((value) => is(value, PgTable)) as AnyPgTable[])
  .map((table) => getTableConfig(table).name)
  .sort();

let client: PGlite | undefined;
afterEach(async () => { await client?.close(); client = undefined; });

async function freshDb(opts: { supabaseRoles: boolean | "anon-only" }) {
  client = new PGlite();
  const db = drizzle({ client, schema });
  if (opts.supabaseRoles) {
    await client.exec("CREATE ROLE anon NOLOGIN");
    if (opts.supabaseRoles === true) await client.exec("CREATE ROLE authenticated NOLOGIN");
    const grantees = opts.supabaseRoles === true ? "anon, authenticated" : "anon";
    await client.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${grantees}`);
    await client.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${grantees}`);
  }
  return db;
}

async function rls(names: string[]): Promise<Record<string, boolean>> {
  const { rows } = await client!.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
  );
  return Object.fromEntries(rows.filter((r) => names.includes(r.relname)).map((r) => [r.relname, r.relrowsecurity]));
}

async function apiPrivileges(names: string[], roles = ["anon", "authenticated"]): Promise<string[]> {
  const granted: string[] = [];
  for (const table of names) {
    for (const role of roles) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const { rows } = await client!.query<{ ok: boolean }>(
          "select has_table_privilege($1, $2::regclass, $3) as ok", [role, `public.${table}`, privilege]);
        if (rows[0]?.ok) granted.push(`${role} ${privilege} ${table}`);
      }
    }
  }
  const { rows: seqs } = await client!.query<{ relname: string }>(
    "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S'");
  for (const seq of seqs) {
    for (const role of roles) {
      for (const privilege of ["USAGE", "SELECT", "UPDATE"]) {
        const { rows } = await client!.query<{ ok: boolean }>(
          "select has_sequence_privilege($1, $2::regclass, $3) as ok", [role, `public.${seq.relname}`, privilege]);
        if (rows[0]?.ok) granted.push(`${role} ${privilege} sequence ${seq.relname}`);
      }
    }
  }
  return granted;
}

describe("Supabase API-role lockdown", () => {
  it("the post-migrate table list is every pgTable in lib/db/schema.ts", () => {
    expect([...API_LOCKDOWN_TABLES].sort()).toEqual(schemaTableNames);
    expect(schemaTableNames.length).toBeGreaterThanOrEqual(21);
  });

  it("migration 0016 names only tables the schema declares, and every table that existed when it was written", () => {
    const sqlText = readFileSync("./drizzle/0016_supabase_api_lockdown.sql", "utf8");
    const list = /ARRAY\[([^\]]+)\]/.exec(sqlText)?.[1] ?? "";
    const named = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    for (const name of named) expect(schemaTableNames).toContain(name);
    for (const name of ["review_notifications", "installation", "audit_events", "sessions", "evidence_documents"]) {
      expect(named).toContain(name);
    }
    expect(new Set(named).size).toBe(21);
  });

  it("on a Supabase-shaped database, migrate leaves RLS on and every API grant revoked", async () => {
    const db = await freshDb({ supabaseRoles: true });
    // Only the journal, so this proves migration 0016 itself, not the post-migrate step.
    // Tables that later migrations add (run_budget_workspace, ...) are covered by the post-migrate step: see the next test.
    await migrate(db, { migrationsFolder: "./drizzle" });
    const list = /ARRAY\[([^\]]+)\]/.exec(readFileSync("./drizzle/0016_supabase_api_lockdown.sql", "utf8"))?.[1] ?? "";
    const named = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(Object.values(await rls(named)).every(Boolean)).toBe(true);
    expect(Object.keys(await rls(named))).toHaveLength(named.length);
    expect(await apiPrivileges(named)).toEqual([]);
  });

  it("the real migrate path does the same, for every table including ones added after 0016", async () => {
    const db = await freshDb({ supabaseRoles: true });
    await applyMigrations(db, "pglite");
    expect(schemaTableNames).toContain("run_budget_workspace");
    expect(Object.values(await rls(schemaTableNames)).every(Boolean)).toBe(true);
    expect(await apiPrivileges(schemaTableNames)).toEqual([]);
  });

  it("a table added by a later migration is locked down by the post-migrate step", async () => {
    const db = await freshDb({ supabaseRoles: true });
    await applyMigrations(db, "pglite");
    await client!.exec("CREATE TABLE later_table (id serial PRIMARY KEY, note text)");
    expect((await apiPrivileges(["later_table"])).length).toBeGreaterThan(0); // default privileges granted it
    await applyApiRoleLockdown(db, [...API_LOCKDOWN_TABLES, "later_table"]);
    expect((await rls(["later_table"])).later_table).toBe(true);
    expect(await apiPrivileges(["later_table"])).toEqual([]);
  });

  it("changes nothing on a database without the Supabase roles", async () => {
    const db = await freshDb({ supabaseRoles: false });
    await applyMigrations(db, "pglite");
    expect(Object.values(await rls(schemaTableNames)).some(Boolean)).toBe(false);
    await applyApiRoleLockdown(db);
    expect(Object.values(await rls(schemaTableNames)).some(Boolean)).toBe(false);
  });

  it("changes nothing when only one of the two roles exists", async () => {
    const db = await freshDb({ supabaseRoles: "anon-only" });
    await applyMigrations(db, "pglite");
    expect(Object.values(await rls(schemaTableNames)).some(Boolean)).toBe(false);
    expect((await apiPrivileges(["audit_events"], ["anon"])).length).toBeGreaterThan(0);
  });

  it("fails loudly, naming the step, when the lockdown statement fails", async () => {
    const db = await freshDb({ supabaseRoles: true });
    await applyMigrations(db, "pglite");
    const failure = await applyApiRoleLockdown(db, ["no_such_table"]).then(() => "", (error: Error) => error.message);
    expect(failure).toMatch(/API-role lockdown failed/);
  });

  it("is idempotent", async () => {
    const db = await freshDb({ supabaseRoles: true });
    await applyMigrations(db, "pglite");
    await applyMigrations(db, "pglite");
    await applyApiRoleLockdown(db);
    expect(await apiPrivileges(schemaTableNames)).toEqual([]);
    await db.execute(sql`select 1`);
  });
});
