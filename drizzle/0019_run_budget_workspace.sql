-- Hand-written migration (not drizzle-kit generated).
--
-- Per-workspace share of the daily model budget (decision d06).
--
-- run_budget holds one install-wide counter per UTC day. One visitor could use
-- all of it in a few requests and block everyone else until midnight. This
-- table counts what each workspace has reserved that day; the app refuses a
-- reservation that would take a workspace past 10 percent of the daily cap, and
-- makes it in the same transaction as the run_budget increment.
CREATE TABLE "run_budget_workspace" (
	"day" text NOT NULL,
	"workspace_id" text NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "run_budget_workspace_day_workspace_id_pk" PRIMARY KEY("day","workspace_id")
);
