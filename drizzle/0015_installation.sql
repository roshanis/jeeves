-- Hand-written migration (not drizzle-kit generated).
--
-- The installation stamp.
--
-- One row that says what kind of installation this database is: 'demo' (the
-- public playground) or 'production' (a customer install). The app refuses to
-- boot when JEEVES_MODE disagrees with it (lib/config/installation-check.ts),
-- which is what stops a demo-mode process from opening passwordless personas
-- on a production database, and a production process from serving a database
-- full of seeded demo rows. scripts/seed.ts and scripts/reset-demo.ts read it
-- too, and refuse a 'production' database even when ALLOW_SEED=1.
--
-- A stamp is only worth anything if it cannot be rewritten, so:
--   - `id boolean ... CHECK (id)` makes the table a singleton: the only legal
--     key is true, so a second row is a duplicate-key error.
--   - deploy_mode and install_id are immutable once written (UPDATE trigger).
--     org_workspace_id and reference_seed_version are filled in later by the
--     install script and may change.
--   - DELETE and TRUNCATE are blocked. Statement-level TRUNCATE needs its own
--     trigger, for the reason given in 0014. Nothing references this table, so
--     TRUNCATE ... CASCADE on another table never reaches it.
--
-- Like 0002 and 0014, this is a trigger rather than a role split because the
-- demo (PGlite, Neon) runs as a single role. An owner can still run
-- `ALTER TABLE installation DISABLE TRIGGER USER`; the production grant matrix
-- (a later phase) takes TRIGGER away from the application role.
--
-- The demo database already exists and holds visitors' work, so nothing here
-- backfills a row: the demo stamps itself at boot with INSERT ... ON CONFLICT
-- DO NOTHING (lib/demo/bootstrap.ts) and a production install is stamped by
-- its install script.
CREATE TABLE "installation" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"deploy_mode" text NOT NULL,
	"install_id" text NOT NULL,
	"org_workspace_id" text,
	"reference_seed_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_singleton" CHECK ("id"),
	CONSTRAINT "installation_deploy_mode_check" CHECK ("deploy_mode" IN ('demo', 'production'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "installation_guard"()
RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW."deploy_mode" IS DISTINCT FROM OLD."deploy_mode" THEN
			RAISE EXCEPTION 'installation.deploy_mode is immutable once written (this database is stamped %)',
				OLD."deploy_mode";
		END IF;
		IF NEW."install_id" IS DISTINCT FROM OLD."install_id" THEN
			RAISE EXCEPTION 'installation.install_id is immutable once written';
		END IF;
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'installation is a permanent record: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "installation_no_rewrite"
BEFORE UPDATE ON "installation"
FOR EACH ROW
EXECUTE FUNCTION "installation_guard"();
--> statement-breakpoint
CREATE TRIGGER "installation_no_delete"
BEFORE DELETE ON "installation"
FOR EACH ROW
EXECUTE FUNCTION "installation_guard"();
--> statement-breakpoint
CREATE TRIGGER "installation_no_truncate"
BEFORE TRUNCATE ON "installation"
FOR EACH STATEMENT
EXECUTE FUNCTION "installation_guard"();
