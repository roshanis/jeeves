// Supabase API-role lockdown, applied after every migrate run.
//
// Supabase's Data API (PostgREST) serves public-schema tables to the `anon`
// and `authenticated` roles, and the platform grants them access to every new
// table by default. Jeeves never uses that API, so each table must have RLS on
// and no grant for those roles. Migration 0016 does this for the tables that
// existed when it was written; this step covers the tables later migrations
// add, so one `db:migrate` run always ends locked down.
//
// It does nothing unless BOTH roles exist. Never enable RLS elsewhere: on
// RDS or Podman a runtime role that does not own the tables (decision d05)
// would see zero rows once RLS is on and no policy exists.
//
// Deliberately a DO block sent as plain SQL: a SQL function in public would be
// executable by PUBLIC and reachable through Supabase's RPC endpoint.
import { getTableConfig, PgTable, type AnyPgTable } from "drizzle-orm/pg-core";
import { is, sql } from "drizzle-orm";
import * as schema from "./schema";

/** Every table lib/db/schema.ts declares, by SQL name. */
export const API_LOCKDOWN_TABLES: readonly string[] = (Object.values(schema).filter((value) => is(value, PgTable)) as AnyPgTable[])
  .map((table) => getTableConfig(table).name);

/** The guarded lockdown as one SQL statement over the given public-schema tables. */
export function apiRoleLockdownSql(tables: readonly string[]): string {
  const names = tables.map((name) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Refusing to lock down table with unexpected name: ${name}`);
    return `'${name}'`;
  });
  return `DO $jeeves_lockdown$
DECLARE
  tbl text;
  seq regclass;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')) THEN
    RETURN;
  END IF;
  FOREACH tbl IN ARRAY ARRAY[${names.join(", ")}] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', tbl);
    FOR seq IN
      SELECT s.oid::regclass
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
      WHERE s.relkind = 'S' AND d.refobjid = format('public.%I', tbl)::regclass
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
    END LOOP;
  END LOOP;
END
$jeeves_lockdown$`;
}

/** Apply the lockdown through a Drizzle handle. A failure names this step. */
export async function applyApiRoleLockdown(
  db: { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> },
  tables: readonly string[] = API_LOCKDOWN_TABLES,
): Promise<void> {
  try {
    await db.execute(sql.raw(apiRoleLockdownSql(tables)));
  } catch (error) {
    throw new Error("Supabase API-role lockdown failed after migrating; the database is not locked down", { cause: error });
  }
}
