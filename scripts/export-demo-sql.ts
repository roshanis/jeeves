/**
 * Export a reviewable, insertion-only Meridian Health import.
 * The legacy reset seed runs ONLY in a new in-memory PGlite instance.
 * This script never opens the configured runtime DB or uses its credentials.
 * Usage: npx tsx scripts/export-demo-sql.ts > /tmp/meridian-demo.sql
 */
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../lib/db/schema";
import { seedDatabase } from "./seed";

// FK order. Runtime sessions, budgets, rate limits and evidence are excluded.
const TABLES = [
  "control_definitions", "initiatives", "intake_versions", "risk_assessments",
  "review_cycles", "review_decisions", "initiative_decisions", "deployment_versions",
  "effective_controls", "control_exceptions", "observations", "incidents", "audit_events",
] as const;
const MARKER = "meridian-demo-import-v1";

export async function exportDemoSql(): Promise<string> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  try {
    await client.exec("SET TIME ZONE 'UTC'");
    await migrate(db, { migrationsFolder: "./drizzle" });
    await seedDatabase(db);
    for (const table of TABLES) {
      const result = await client.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
      );
      snapshot[table] = result.rows.map(({ row }) => row);
    }
  } finally {
    await client.close();
  }
  const json = JSON.stringify(snapshot);
  const fingerprint = createHash("sha256").update(json).digest("hex");
  // Escape JSON as an ordinary SQL literal; standard_conforming_strings is
  // pinned below so backslashes and quotes cannot alter the generated SQL.
  const literal = `'${json.replaceAll("'", "''")}'::jsonb`;
  const markerMetadata = JSON.stringify({ fixture: "Meridian Health", version: 1, sha256: fingerprint, synthetic: true });
  const records = (table: string) => `jsonb_populate_recordset(NULL::public.${table}, payload->'${table}')`;

  return `-- Meridian Health fictional sample. Generated offline; review before execution.
-- SHA-256 of fixture: ${fingerprint}
-- Adds 12 shared examples. Preserves visitor data, accounting and audit triggers.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $meridian_import$
DECLARE
  payload jsonb := ${literal};
  imported boolean;
  present_count integer;
  has_fixture boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(17435925, 1);
  SELECT EXISTS (SELECT 1 FROM public.audit_events WHERE id = '${MARKER}') INTO imported;
  IF imported AND NOT EXISTS (
    SELECT 1 FROM public.audit_events WHERE id = '${MARKER}'
      AND initiative_id IS NULL AND actor = 'system' AND actor_role = 'system'
      AND action = 'demo_fixture_imported' AND metadata = '${markerMetadata}'::jsonb
      AND detail = 'Imported the fictional Meridian Health v1 portfolio; historical events are synthetic examples.'
      AND "before" IS NULL AND "after" IS NULL
  ) THEN RAISE EXCEPTION 'Meridian fixture marker conflict'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.initiatives t JOIN ${records("initiatives")} e ON t.slug = e.slug
    WHERE t.id <> e.id
  ) THEN RAISE EXCEPTION 'Meridian initiative slug conflict'; END IF;
${TABLES.map((table) => `
  IF EXISTS (
    SELECT 1 FROM public.${table} t JOIN ${records(table)} e USING (id)
    WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(e)
  ) THEN RAISE EXCEPTION 'Meridian fixture conflict in ${table}'; END IF;
  SELECT count(*) INTO present_count FROM public.${table} t JOIN ${records(table)} e USING (id);
  IF imported AND present_count <> jsonb_array_length(payload->'${table}') THEN
    RAISE EXCEPTION 'Meridian fixture incomplete in ${table}';
  END IF;
${table === "control_definitions" ? "" : "  has_fixture := has_fixture OR present_count > 0;"}`).join("\n")}
  IF imported THEN RETURN; END IF;
  IF has_fixture THEN RAISE EXCEPTION 'Meridian fixture incomplete: existing rows without import marker'; END IF;
${TABLES.map((table) => `
  INSERT INTO public.${table} SELECT e.* FROM ${records(table)} e${table === "control_definitions" ? `
    WHERE NOT EXISTS (SELECT 1 FROM public.control_definitions t WHERE t.id = e.id)` : ""};`).join("\n")}
  INSERT INTO public.audit_events (id, ts, actor, actor_role, action, detail, metadata)
  VALUES ('${MARKER}', transaction_timestamp(), 'system', 'system', 'demo_fixture_imported',
    'Imported the fictional Meridian Health v1 portfolio; historical events are synthetic examples.', '${markerMetadata}'::jsonb);
END
$meridian_import$;
COMMIT;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportDemoSql().then((sql) => process.stdout.write(sql)).catch(() => {
    console.error("Could not generate the fictional demo import. No hosted database was accessed.");
    process.exitCode = 1;
  });
}
