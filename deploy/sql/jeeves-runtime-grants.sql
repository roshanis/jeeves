-- Jeeves database roles: grants for the two-role layout (docs/deploy.md, "Database roles").
--
--   jeeves_owner  owns the schema; used only by `npm run db:migrate` (DATABASE_MIGRATION_URL).
--   jeeves_app    owns nothing; the application's runtime role (DATABASE_URL).
--
-- Create the two roles first (a login role each, NOSUPERUSER, with your own
-- passwords), then run THIS file as an administrator in the Jeeves database:
--
--   CREATE ROLE jeeves_owner LOGIN NOSUPERUSER PASSWORD '<owner password>';
--   CREATE ROLE jeeves_app   LOGIN NOSUPERUSER PASSWORD '<app password>';
--
-- Run it before the first `db:migrate`, and again after it. It is idempotent.
-- Before the migrate, the default privileges make every table the owner creates
-- usable by jeeves_app. After it, the last section narrows the append-only
-- tables: the triggers from migrations 0002, 0011, 0014, 0015 and 0017 refuse
-- UPDATE and DELETE on them whatever the grants say, and the app cannot switch
-- the triggers off because it does not own the tables; withholding the
-- privileges as well is a second layer, not the control.
--
-- jeeves_app never gets TRUNCATE, TRIGGER, REFERENCES or any CREATE right.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO jeeves_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO jeeves_app', current_database());
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO jeeves_owner;
GRANT USAGE ON SCHEMA public TO jeeves_app;

-- Tables and sequences that later migrations create get the same grants.
-- The drizzle schema (migration history, read by the production boot check)
-- is created by the first migrate, so its grants come from these defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE jeeves_owner GRANT USAGE ON SCHEMAS TO jeeves_app;
ALTER DEFAULT PRIVILEGES FOR ROLE jeeves_owner GRANT SELECT ON TABLES TO jeeves_app;
ALTER DEFAULT PRIVILEGES FOR ROLE jeeves_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jeeves_app;
ALTER DEFAULT PRIVILEGES FOR ROLE jeeves_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jeeves_app;

-- Objects that already exist (a re-run after the migrate).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jeeves_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jeeves_app;
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA drizzle TO jeeves_app;
    GRANT SELECT ON drizzle.__drizzle_migrations TO jeeves_app;
  END IF;
END
$$;

-- Append-only tables: read and insert only. evidence_packets keeps UPDATE
-- because a draft packet is revised and then submitted in place; its trigger
-- freezes it once submitted.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['audit_events', 'evidence_documents', 'evidence_assessments', 'installation', 'evidence_packets'] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM jeeves_app', tbl);
      IF tbl <> 'evidence_packets' THEN
        EXECUTE format('REVOKE UPDATE ON public.%I FROM jeeves_app', tbl);
      END IF;
    END IF;
  END LOOP;
END
$$;
