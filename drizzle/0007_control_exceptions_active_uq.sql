-- Hand-written migration (not drizzle-kit generated — drizzle.config.ts
-- requires DATABASE_URL, unavailable in this environment).
--
-- External-review finding #5 (P1): "Exception renewals can corrupt control
-- status ... There is no active-exception uniqueness constraint." A renewal
-- opens a second 'requested' control_exceptions row while the original stays
-- 'approved'; lib/services/exception-service.ts now supersedes the original
-- atomically when the renewal is decided, but that app-layer invariant needs
-- a DB-level backstop. These two partial unique indexes enforce: at most one
-- 'requested' row AND at most one 'approved' row per effective_control_id at
-- a time (the two statuses are independent partial indexes, so one row in
-- each state simultaneously — original approved, renewal requested — is
-- allowed, matching the renewal workflow).
--
-- Verified before adding: scripts/seed.ts inserts exactly one control_exceptions
-- row (status 'requested') for the one effective control it seeds an
-- exception against — no existing seed/test data violates either index.
CREATE UNIQUE INDEX "control_exceptions_one_requested_uq" ON "control_exceptions" ("effective_control_id") WHERE "status" = 'requested';
--> statement-breakpoint
CREATE UNIQUE INDEX "control_exceptions_one_approved_uq" ON "control_exceptions" ("effective_control_id") WHERE "status" = 'approved';
