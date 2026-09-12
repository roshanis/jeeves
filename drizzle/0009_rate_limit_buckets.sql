-- Hand-written migration (not drizzle-kit generated).
--
-- Shared token-bucket storage for rate limiting.
--
-- The limiter (lib/security/rate-limit.ts) keeps its buckets in a
-- module-scoped Map. On a serverless fan-out each instance therefore has its
-- own buckets, so a caller gets a fresh allowance simply by landing on a
-- different instance, and every cold start resets the state. That matters
-- most for the passcode brute-force gate on POST /api/session: configured at
-- 5 attempts refilling one per 30s, it was in practice 5 attempts PER WARM
-- INSTANCE. docs/production-readiness.md §1.2.
--
-- Sessions and the daily token budget already moved to Postgres for the same
-- reason; this is the last piece of per-request guard state that did not.
--
-- `tokens` is double precision because refill is fractional (capacity 5 at
-- 1/30 tokens per second). `last_refill_ms` is an epoch-ms bigint, matching
-- sessions.expires_at, so the refill arithmetic stays in the units the
-- limiter already uses.
CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"last_refill_ms" bigint NOT NULL,
	"last_touched_ms" bigint NOT NULL
);
--> statement-breakpoint
-- Supports pruning full, idle buckets without a full scan.
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_last_touched_idx"
	ON "rate_limit_buckets" ("last_touched_ms");
