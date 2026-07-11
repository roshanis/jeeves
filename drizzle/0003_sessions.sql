-- Hand-written migration (not drizzle-kit generated — drizzle.config.ts
-- requires DATABASE_URL, unavailable in this environment).
--
-- M2.5 inc.1: demo sessions move from a module-scoped in-memory Map to a
-- DB-backed table so a session (and the persona it's bound to) survives a
-- process restart / is shared across multiple serverless instances. One row
-- per issued session token; `expires_at` is an epoch-ms cutoff checked
-- against Date.now() in app code (lib/services/route-guard.ts), not
-- enforced by Postgres.
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"persona_key" text NOT NULL,
	"workspace_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
