-- Hand-written migration (not drizzle-kit generated).
--
-- Supabase API-role lockdown.
--
-- Supabase serves the public schema through its Data API to the `anon` and
-- `authenticated` roles, and grants those roles access to every table created
-- there. Jeeves never uses the Data API, so anyone holding the project's anon
-- key could otherwise read sessions (bearer tokens), intake rows and evidence,
-- and INSERT forged audit_events (the append-only triggers block only UPDATE,
-- DELETE and TRUNCATE). The live demo database was locked down by hand in
-- September 2026 (docs/DEPLOYED-DEMO-REPAIR-2026-09-20.md); that SQL was never
-- committed and predates review_notifications (0013) and installation (0015).
--
-- This migration does for every Jeeves table what the hand-run one did: enable
-- row level security and revoke all access from PUBLIC, anon and authenticated,
-- on the tables and on any sequence they own. The list is explicit rather than
-- "every table in public" because a Supabase project can hold other objects.
-- Tables added after this migration are covered by the lockdown that
-- lib/db/migrate.ts runs after every migrate (lib/db/api-role-lockdown.ts).
--
-- It does nothing unless BOTH roles exist, so Neon, RDS, Podman and PGlite are
-- untouched. Never enable RLS on a database without them: a runtime role that
-- does not own the tables (decision d05) would see zero rows with RLS on and no
-- policy. There is deliberately no ALTER DEFAULT PRIVILEGES (it would act on
-- objects other tools create) and no SQL function (a function in public is
-- executable by PUBLIC and reachable through Supabase's RPC endpoint).
-- The initiative_registry view (0001) is revoked too while it exists; 0018 drops it.
DO $jeeves_lockdown$
DECLARE
  tbl text;
  seq regclass;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')) THEN
    RETURN;
  END IF;
  FOREACH tbl IN ARRAY ARRAY['initiatives', 'intake_versions', 'risk_assessments', 'review_cycles', 'review_decisions', 'initiative_decisions', 'deployment_versions', 'control_definitions', 'effective_controls', 'observations', 'incidents', 'audit_events', 'run_budget', 'sessions', 'control_exceptions', 'review_notifications', 'rate_limit_buckets', 'installation', 'evidence_documents', 'evidence_packets', 'evidence_assessments'] LOOP
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
  IF to_regclass('public.initiative_registry') IS NOT NULL THEN
    REVOKE ALL ON public.initiative_registry FROM PUBLIC, anon, authenticated;
  END IF;
END
$jeeves_lockdown$;
