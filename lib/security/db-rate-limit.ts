/**
 * Shared-store token-bucket rate limiter.
 *
 * ./rate-limit.ts keeps its buckets in a module-scoped `Map`, which is
 * per-process — and therefore per serverless instance. A caller gets a fresh
 * allowance simply by landing on a different instance, and every cold start
 * resets the state. The anonymous workspace-creation gate on POST /api/session,
 * configured as 5 attempts refilling one per 30s, was in practice 5 attempts
 * PER WARM INSTANCE (docs/production-readiness.md §1.2). Sessions and the
 * daily token budget already moved to Postgres for exactly this reason.
 *
 * The consume path is ONE statement — an `INSERT … ON CONFLICT DO UPDATE`
 * whose `WHERE` re-derives the refilled balance and applies only when a
 * token is actually available. That is the same compare-and-set shape
 * `DbBudgetStore.reserveAtomic()` uses, and it is what makes concurrent
 * requests across instances safe: the refill-check-consume sequence cannot
 * interleave, because it never leaves the database.
 *
 * A read-modify-write in application code would NOT be safe here, however
 * carefully written — two instances would both read the same balance and
 * both consume it.
 *
 * The clock stays an injected dependency, as in the in-memory limiter, so
 * behaviour is deterministic under test.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { RateLimiterConfig, RateLimitResult } from "./rate-limit";

export class DbTokenBucketRateLimiter {
  constructor(
    private readonly config: RateLimiterConfig,
    private readonly getDb: () => Db,
    private readonly now: () => number,
  ) {}

  /**
   * Attempt to consume one token for `key`. Returns `allowed: false` plus
   * the wait in seconds when the bucket is empty.
   */
  async checkAndConsume(key: string): Promise<RateLimitResult> {
    const db = this.getDb();
    const nowMs = this.now();
    const { capacity, refillPerSecond } = this.config;

    // Refilled balance, recomputed inside the statement from the stored
    // timestamp so it can never be stale relative to a concurrent writer.
    const refilled = sql`least(
      ${capacity}::double precision,
      "rate_limit_buckets"."tokens"
        + (greatest(${nowMs}::bigint - "rate_limit_buckets"."last_refill_ms", 0)::double precision / 1000.0)
          * ${refillPerSecond}::double precision
    )`;

    // The refill stamp only moves forward (greatest below). If an instance
    // whose clock runs ahead wrote it, the bucket keeps its tokens and does not
    // refill until real time catches up. Without the clamp in `refilled`, the
    // negative elapsed time would deny every request outright.
    const rows = await db.execute(sql`
      insert into "rate_limit_buckets" ("key", "tokens", "last_refill_ms", "last_touched_ms")
      values (${key}, ${capacity - 1}::double precision, ${nowMs}::bigint, ${nowMs}::bigint)
      on conflict ("key") do update set
        "tokens" = ${refilled} - 1,
        "last_refill_ms" = greatest("rate_limit_buckets"."last_refill_ms", ${nowMs}::bigint),
        "last_touched_ms" = greatest("rate_limit_buckets"."last_touched_ms", ${nowMs}::bigint)
      where ${refilled} >= 1
      returning "tokens"
    `);

    // A row comes back when the insert created the bucket, or when the
    // conditional update fired. No row means the bucket was empty.
    if (this.rowCount(rows) > 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // No row here means the bucket was removed in between: the next call starts a fresh one.
    return { allowed: false, retryAfterSeconds: (await this.read(key, nowMs))?.waitSeconds ?? 0 };
  }

  /**
   * Read-only: would `checkAndConsume(key)` be allowed now? Writes nothing.
   * A key with no row is allowed.
   */
  async peek(key: string): Promise<RateLimitResult> {
    const bucket = await this.read(key, this.now());
    return !bucket || bucket.balance >= 1
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: bucket.waitSeconds };
  }

  /**
   * Evict buckets that are both full and untouched for `staleAfterMs`.
   * Only full buckets qualify, so state is never dropped for a client that
   * is still partially throttled — same rule as the in-memory limiter.
   * `limit` bounds how many rows one call removes (unbounded when omitted).
   * Returns the number of rows removed.
   */
  async prune(staleAfterMs: number, limit?: number): Promise<number> {
    const db = this.getDb();
    const nowMs = this.now();
    const { capacity, refillPerSecond } = this.config;

    const rows = await db.execute(sql`
      delete from "rate_limit_buckets" where "key" in (
        select "key" from "rate_limit_buckets"
        where "last_touched_ms" <= ${nowMs - staleAfterMs}::bigint
          and least(
            ${capacity}::double precision,
            "tokens" + ((${nowMs}::bigint - "last_refill_ms")::double precision / 1000.0)
              * ${refillPerSecond}::double precision
          ) >= ${capacity}::double precision
        limit ${limit ?? null}::integer
      )
      returning "key"
    `);
    return this.rowCount(rows);
  }

  /**
   * The bucket as `checkAndConsume` would see it now: the refilled balance, and
   * the wait until one token is available. The wait is in whole seconds,
   * rounded up, because that is what a Retry-After header carries. It includes
   * the time until a refill stamp written by a faster clock is reached, since
   * the bucket does not refill before then. Null when the key has no row.
   */
  private async read(key: string, nowMs: number): Promise<{ balance: number; waitSeconds: number } | null> {
    const { capacity, refillPerSecond } = this.config;
    const rows = await this.getDb().execute(sql`
      select
        least(
          ${capacity}::double precision,
          "tokens" + (greatest(${nowMs}::bigint - "last_refill_ms", 0)::double precision / 1000.0)
            * ${refillPerSecond}::double precision
        ) as "balance",
        greatest("last_refill_ms" - ${nowMs}::bigint, 0)::double precision / 1000.0 as "ahead"
      from "rate_limit_buckets" where "key" = ${key}
    `);
    const row = this.firstRow(rows);
    if (!row) return null;

    const balance = Number(row.balance);
    if (balance >= 1) return { balance, waitSeconds: 0 };
    if (refillPerSecond <= 0) return { balance, waitSeconds: Number.POSITIVE_INFINITY };
    const seconds = Number(row.ahead) + (1 - balance) / refillPerSecond;
    // To the millisecond first, so 9.000000000000002 does not become 10.
    return { balance, waitSeconds: Math.ceil(Math.round(seconds * 1000) / 1000) };
  }

  // drizzle's execute() returns a driver-shaped result: neon-serverless gives
  // `{ rows, rowCount }`, PGlite gives `{ rows }`, and some paths return a
  // bare array. Normalised here rather than at every call site.
  private rowsOf(result: unknown): Record<string, unknown>[] {
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    const rows = (result as { rows?: unknown })?.rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }

  private rowCount(result: unknown): number {
    return this.rowsOf(result).length;
  }

  private firstRow(result: unknown): Record<string, unknown> | undefined {
    return this.rowsOf(result)[0];
  }
}
