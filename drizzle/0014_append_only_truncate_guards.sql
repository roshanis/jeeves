-- Hand-written migration (not drizzle-kit generated).
--
-- TRUNCATE guards for the append-only tables.
--
-- 0002 (audit_events) and 0011 (evidence_documents, evidence_assessments,
-- evidence_packets) make those tables immutable with FOR EACH ROW triggers on
-- UPDATE and DELETE. Postgres never fires row-level triggers for TRUNCATE, so
-- the guarantee had a hole: `TRUNCATE audit_events` emptied the compliance
-- record in one statement, and `TRUNCATE initiatives CASCADE` did the same
-- from the other side, because CASCADE truncates every table whose foreign key
-- reaches initiatives (audit_events, evidence_*, review_cycles ...).
--
-- A statement-level BEFORE TRUNCATE trigger closes it. Triggers fire for each
-- table a TRUNCATE touches, including tables pulled in by CASCADE, so guarding
-- the four protected tables also blocks every foreign-key route to them.
--
-- Deliberate maintenance (scripts/seed.ts, scripts/reset-demo.ts) clears
-- audit_events with `ALTER TABLE ... DISABLE TRIGGER USER` around a DELETE.
-- DISABLE TRIGGER USER covers these triggers and, unlike DISABLE TRIGGER ALL,
-- does not need superuser, which an RDS master user is not.
CREATE OR REPLACE FUNCTION "append_only_truncate_guard"()
RETURNS TRIGGER AS $$
BEGIN
	RAISE EXCEPTION '% is append-only: TRUNCATE is not permitted', TG_TABLE_NAME;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "append_only_truncate_guard"();
--> statement-breakpoint
CREATE TRIGGER "evidence_documents_no_truncate"
BEFORE TRUNCATE ON "evidence_documents"
FOR EACH STATEMENT
EXECUTE FUNCTION "append_only_truncate_guard"();
--> statement-breakpoint
CREATE TRIGGER "evidence_assessments_no_truncate"
BEFORE TRUNCATE ON "evidence_assessments"
FOR EACH STATEMENT
EXECUTE FUNCTION "append_only_truncate_guard"();
--> statement-breakpoint
CREATE TRIGGER "evidence_packets_no_truncate"
BEFORE TRUNCATE ON "evidence_packets"
FOR EACH STATEMENT
EXECUTE FUNCTION "append_only_truncate_guard"();
