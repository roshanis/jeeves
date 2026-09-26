/** Shared configuration and result types for the database-backed rate limiter. */
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
