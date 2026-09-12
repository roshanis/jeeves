-- Hand-written migration (not drizzle-kit generated).
--
-- Indexes for the columns the read paths actually filter and join on.
-- Postgres creates indexes for PRIMARY KEY and UNIQUE constraints only — it
-- does NOT index foreign keys — and several of the composite uniques in this
-- schema happen to cover their leading FK column while others have no cover
-- at all. docs/production-readiness.md §2.4.
--
-- Honest scope note: these help point lookups and joins. They do NOT address
-- the dominant cost at real volumes, which is the read model itself —
-- lib/data/db-provider.ts loads whole tables and assembles the portfolio in
-- memory ("simpler and more auditable than a lattice of joins, and well
-- within budget for a Neon/PGlite demo database"), and the Inbox fans out to
-- one getInitiativeDetail per initiative. Both are correct trades at 12
-- initiatives and both need revisiting long before indexes become the
-- limiting factor. An index cannot speed up a query that reads every row.
--
-- These are not declared in lib/db/schema.ts. That is consistent with how
-- this repo already treats hand-written migrations — 0001 creates a view and
-- 0002 installs triggers, neither of which schema.ts expresses either — so
-- schema.ts is the table model, not a complete description of the database.
-- Anyone running `drizzle-kit generate` should expect that gap and not take
-- its output as authoritative here.

-- Workspace read-isolation filters EVERY read (viewerWorkspaceId), so this is
-- the one that matters most. Partial-friendly: NULL workspace_id marks the
-- shared seeded demo rows.
CREATE INDEX IF NOT EXISTS "initiatives_workspace_idx"
	ON "initiatives" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_cycles_initiative_idx"
	ON "review_cycles" ("initiative_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_versions_initiative_idx"
	ON "deployment_versions" ("initiative_id");
--> statement-breakpoint
-- Telemetry series are read per deployment and kind, ordered by time, so the
-- composite serves the filter and the sort together.
CREATE INDEX IF NOT EXISTS "observations_deployment_kind_ts_idx"
	ON "observations" ("deployment_id", "kind", "ts");
--> statement-breakpoint
-- The audit trail is read per initiative and is the table that grows without
-- bound — it is append-only, so nothing ever removes rows from it.
CREATE INDEX IF NOT EXISTS "audit_events_initiative_ts_idx"
	ON "audit_events" ("initiative_id", "ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "control_exceptions_effective_control_idx"
	ON "control_exceptions" ("effective_control_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "control_exceptions_initiative_idx"
	ON "control_exceptions" ("initiative_id");
