-- Hand-written migration (not drizzle-kit generated).
--
-- Guard triggers fire in every session (ENABLE ALWAYS).
--
-- The append-only guards from 0002, 0011, 0014 and the installation guards
-- from 0015 were created in the default state, which does not fire when a
-- session sets session_replication_role = replica (a role with that right can
-- use it to rewrite audit_events or installation past the guards). ENABLE
-- ALWAYS makes them fire regardless.
--
-- This does not stop the table owner: an owner can still DISABLE or DROP a
-- trigger or replace its function. That is closed by running the application as
-- a role that owns nothing, with migrations run by a separate owner role
-- (DATABASE_MIGRATION_URL; see docs/deploy.md). Code that disables the guards
-- for a maintenance wipe must re-arm them by name (lib/db/guard-triggers.ts):
-- ENABLE TRIGGER USER would put them back to the default state.
ALTER TABLE "audit_events" ENABLE ALWAYS TRIGGER "audit_events_no_update";
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ALWAYS TRIGGER "audit_events_no_delete";
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ALWAYS TRIGGER "audit_events_no_truncate";
--> statement-breakpoint
ALTER TABLE "evidence_documents" ENABLE ALWAYS TRIGGER "evidence_documents_immutable";
--> statement-breakpoint
ALTER TABLE "evidence_documents" ENABLE ALWAYS TRIGGER "evidence_documents_no_truncate";
--> statement-breakpoint
ALTER TABLE "evidence_assessments" ENABLE ALWAYS TRIGGER "evidence_assessments_immutable";
--> statement-breakpoint
ALTER TABLE "evidence_assessments" ENABLE ALWAYS TRIGGER "evidence_assessments_no_truncate";
--> statement-breakpoint
ALTER TABLE "evidence_packets" ENABLE ALWAYS TRIGGER "evidence_packets_immutable";
--> statement-breakpoint
ALTER TABLE "evidence_packets" ENABLE ALWAYS TRIGGER "evidence_packets_no_truncate";
--> statement-breakpoint
ALTER TABLE "installation" ENABLE ALWAYS TRIGGER "installation_no_rewrite";
--> statement-breakpoint
ALTER TABLE "installation" ENABLE ALWAYS TRIGGER "installation_no_delete";
--> statement-breakpoint
ALTER TABLE "installation" ENABLE ALWAYS TRIGGER "installation_no_truncate";
