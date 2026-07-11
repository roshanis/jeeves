/**
 * Token-bucket rate limiter keyed by client id (e.g. a hashed IP — hashing
 * is the caller's responsibility, this module only needs an opaque string
 * key), per plan §3 / AGENTS.md hard rule 2 ("per-IP rate limiting").
 *
 * Design notes:
 * - No `Date.now()` anywhere in this module. The clock is an injected
 *   `now: () => number` dependency (ms epoch or any monotonically
 *   increasing unit, as long as it's consistent with `refillPerSecond`
 *   being tokens-per-1000-units), so behavior is fully deterministic and
 *   testable with a fake clock.
 * - Buckets are stored in an in-memory `Map`; `prune()` lets a caller
 *   periodically evict stale entries so memory doesn't grow unbounded
 *   across many distinct client keys over the life of a long-running
 *   process (this is in-memory only — a distributed deployment would need
 *   a shared store, out of scope here per the "pure logic" mandate).
 */

export interface RateLimiterConfig {
  /** Maximum number of tokens (requests) a bucket can hold at once. */
  capacity: number;
  /** Tokens replenished per second (fractional allowed, e.g. 0.5). */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until at least one token will be available. 0 when allowed. */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  /** Clock time used to compute elapsed-time refill amounts. */
  lastRefillMs: number;
  /** Clock time of the last actual client request (`checkAndConsume` call); used only for staleness/pruning, not refill math. */
  lastTouchedMs: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly config: RateLimiterConfig,
    private readonly now: () => number,
  ) {}

  /** Number of tracked buckets (for tests/observability). */
  size(): number {
    return this.buckets.size;
  }

  /**
   * Attempt to consume one token for `key`. Refills the bucket based on
   * elapsed time (per the injected clock) before checking/consuming.
   */
  checkAndConsume(key: string): RateLimitResult {
    const nowMs = this.now();
    const bucket = this.getOrCreateBucket(key, nowMs);
    this.refill(bucket, nowMs);
    bucket.lastTouchedMs = nowMs;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterSeconds = tokensNeeded / this.config.refillPerSecond;
    return { allowed: false, retryAfterSeconds };
  }

  /**
   * Evict buckets that are both full (fully refilled to capacity) and have
   * not been touched for at least `staleAfterMs`. Only full buckets are
   * eligible so we never silently drop rate-limit state for a client that
   * is still partially throttled.
   */
  prune(staleAfterMs: number): void {
    const nowMs = this.now();
    for (const [key, bucket] of this.buckets.entries()) {
      this.refill(bucket, nowMs);
      const idleMs = nowMs - bucket.lastTouchedMs;
      if (bucket.tokens >= this.config.capacity && idleMs >= staleAfterMs) {
        this.buckets.delete(key);
      }
    }
  }

  private getOrCreateBucket(key: string, nowMs: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.capacity, lastRefillMs: nowMs, lastTouchedMs: nowMs };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket, nowMs: number): void {
    const elapsedMs = nowMs - bucket.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    const refillAmount = (elapsedMs / 1000) * this.config.refillPerSecond;
    bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refillAmount);
    bucket.lastRefillMs = nowMs;
  }
}
