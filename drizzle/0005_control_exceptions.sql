-- Hand-written migration (not drizzle-kit generated — drizzle.config.ts
-- requires DATABASE_URL, unavailable in this environment).
--
-- M4: control-exception workflow. A control that cannot currently be met can
-- run under a time-boxed, accountable EXCEPTION: a stakeholder REQUESTS it,
-- an approver/admin (never the requester — separation of duties) APPROVES or
-- REJECTS it, and an approved exception can later be REVOKED, RENEWED (a new
-- request superseding the old), or EXPIRE at its deadline. Every transition is
-- linked to an audit_events row. FK columns are intentionally left as plain
-- text (no DB-level FK constraint) to match the other hand-written migrations
-- and stay PGlite-safe; the app always writes valid references.
CREATE TABLE "control_exceptions" (
  "id" text PRIMARY KEY NOT NULL,
  "effective_control_id" text NOT NULL,
  "control_id" text NOT NULL,
  "initiative_id" text,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "expires_at" bigint,
  "supersedes_id" text,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "control_exceptions_effective_control_idx" ON "control_exceptions" ("effective_control_id");
