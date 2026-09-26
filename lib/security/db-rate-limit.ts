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
        + ((${nowMs}::bigint - "rate_limit_buckets"."last_refill_ms")::double precision / 1000.0)
          * ${refillPerSecond}::double precision
    )`;

    const rows = await db.execute(sql`
      insert into "rate_limit_buckets" ("key", "tokens", "last_refill_ms", "last_touched_ms")
      values (${key}, ${capacity - 1}::double precision, ${nowMs}::bigint, ${nowMs}::bigint)
      on conflict ("key") do update set
        "tokens" = ${refilled} - 1,
        "last_refill_ms" = ${nowMs}::bigint,
        "last_touched_ms" = ${nowMs}::bigint
      where ${refilled} >= 1
      returning "tokens"
    `);

    // A row comes back when the insert created the bucket, or when the
    // conditional update fired. No row means the bucket was empty.
    if (this.rowCount(rows) > 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: false, retryAfterSeconds: await this.retryAfter(key, nowMs) };
  }

  /**
   * Evict buckets that are both full and untouched for `staleAfterMs`.
   * Only full buckets qualify, so state is never dropped for a client that
   * is still partially throttled — same rule as the in-memory limiter.
   * Returns the number of rows removed.
   */
  async prune(staleAfterMs: number): Promise<number> {
    const db = this.getDb();
    const nowMs = this.now();
    const { capacity, refillPerSecond } = this.config;

    const rows = await db.execute(sql`
      delete from "rate_limit_buckets"
      where ${nowMs}::bigint - "last_touched_ms" >= ${staleAfterMs}::bigint
        and least(
          ${capacity}::double precision,
          "tokens" + ((${nowMs}::bigint - "last_refill_ms")::double precision / 1000.0)
            * ${refillPerSecond}::double precision
        ) >= ${capacity}::double precision
      returning "key"
    `);
    return this.rowCount(rows);
  }

  /** Seconds until one token is available, for the Retry-After header. */
  private async retryAfter(key: string, nowMs: number): Promise<number> {
    const { capacity, refillPerSecond } = this.config;
    if (refillPerSecond <= 0) return Number.POSITIVE_INFINITY;

    const rows = await this.getDb().execute(sql`
      select least(
        ${capacity}::double precision,
        "tokens" + ((${nowMs}::bigint - "last_refill_ms")::double precision / 1000.0)
          * ${refillPerSecond}::double precision
      ) as "balance"
      from "rate_limit_buckets" where "key" = ${key}
    `);

    const balance = Number(this.firstRow(rows)?.balance ?? 0);
    return Math.max(0, (1 - balance) / refillPerSecond);
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
