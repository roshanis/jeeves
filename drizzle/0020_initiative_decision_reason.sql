-- Hand-written migration (not drizzle-kit generated).
--
-- The written reason for a rejection (review finding domain-F10).
--
-- 'rejected' is a terminal state, so the requester and any later auditor need
-- the reason on the record: the app now requires one on a rejection and stores
-- it here and on the decision's audit event. Nullable because earlier decisions
-- have none, and approvals never carry one.
ALTER TABLE "initiative_decisions" ADD COLUMN "reason" text;
