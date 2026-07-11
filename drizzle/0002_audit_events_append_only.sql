-- Hand-written migration (not drizzle-kit generated).
--
-- plan.md §5 / §8 test 11: AuditEvent is append-only AT THE DB LEVEL —
-- "revoke UPDATE/DELETE from app role + trigger; tested at DB level, not
-- just app-path." A trigger is used here (rather than relying solely on a
-- GRANT/REVOKE role split) because both PGlite (tests) and Neon serverless
-- (prod) run as a single connection role, so a trigger enforces the
-- invariant regardless of which role issues the statement.
CREATE OR REPLACE FUNCTION "audit_events_append_only"()
RETURNS TRIGGER AS $$
BEGIN
	RAISE EXCEPTION 'audit_events is append-only: % is not permitted (row id=%)',
		TG_OP,
		COALESCE(OLD."id", NEW."id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update"
BEFORE UPDATE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "audit_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_delete"
BEFORE DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "audit_events_append_only"();
--> statement-breakpoint
