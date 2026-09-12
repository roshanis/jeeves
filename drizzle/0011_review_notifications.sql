-- Hand-written migration (not drizzle-kit generated).
--
-- Review-request notifications.
--
-- triage() fans out one pending review per required domain, so a Critical
-- initiative asks all eight domains at once. But nothing ever TOLD those
-- domains. A review row appeared in a queue and waited to be noticed; there
-- was no notification transport in the codebase at all (no SMTP, no webhook,
-- no queue). That is the difference between "Legal has been asked" and
-- "Legal knows they were asked", and it is the difference between a
-- two-hour and a two-week turnaround.
--
-- This table is the durable record of the ask. Rows are written in the SAME
-- transaction that creates the review rows, so the invariant is: if a review
-- exists, the request to fill it was recorded. They cannot disagree.
--
-- DELIVERY IS DELIBERATELY NOT IMPLEMENTED HERE. There is no configured
-- transport, and inventing one would mean a demo that claims to have emailed
-- Legal when nothing left the process — exactly the "no fake integrations"
-- rule this repo holds elsewhere (see the telemetry connector card, which
-- reports "not configured" rather than pretending). `delivered_at` and
-- `delivery_channel` stay NULL until something real ships them, and the UI
-- says so.
CREATE TABLE IF NOT EXISTS "review_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL REFERENCES "initiatives"("id"),
	"cycle_id" text NOT NULL REFERENCES "review_cycles"("id"),
	-- The governance domain being asked (Domain union), e.g. 'legal'.
	"domain" text NOT NULL,
	-- Why they are being asked. 'review_requested' today; kept open so a
	-- return-for-rework or an SLA nudge can reuse the table.
	"kind" text NOT NULL,
	-- Rendered at enqueue time, not at read time: the message must reflect
	-- what was true when the ask was made, not what is true now.
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	-- NULL until a real transport delivers it. See the note above.
	"delivered_at" timestamp with time zone,
	"delivery_channel" text
);
--> statement-breakpoint
-- One ask per (cycle, domain, kind): triage is re-runnable and idempotent
-- per (cycle, domain), so the notification must be too, or a retry would
-- queue a duplicate ask.
CREATE UNIQUE INDEX IF NOT EXISTS "review_notifications_cycle_domain_kind_uq"
	ON "review_notifications" ("cycle_id", "domain", "kind");
--> statement-breakpoint
-- The reviewer-facing read is "what is outstanding for my domain".
CREATE INDEX IF NOT EXISTS "review_notifications_domain_pending_idx"
	ON "review_notifications" ("domain", "delivered_at");
