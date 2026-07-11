import { describe, expect, it } from "vitest";
import { TokenBucketRateLimiter } from "./rate-limit";

/** Simple fake clock: an object whose `.now()` we advance manually in tests. */
function fakeClock(startMs: number) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("TokenBucketRateLimiter — allows a burst up to capacity", () => {
  it("allows exactly `capacity` requests back-to-back with no refill needed", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerSecond: 1 }, clock.now);

    for (let i = 0; i < 5; i++) {
      const result = limiter.checkAndConsume("client-a");
      expect(result.allowed).toBe(true);
    }
  });
});

describe("TokenBucketRateLimiter — blocks once capacity is exhausted", () => {
  it("rejects the (capacity + 1)th request with allowed: false and a retryAfterSeconds > 0", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 }, clock.now);

    for (let i = 0; i < 3; i++) {
      expect(limiter.checkAndConsume("client-b").allowed).toBe(true);
    }
    const blocked = limiter.checkAndConsume("client-b");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("TokenBucketRateLimiter — refills over time via injected clock", () => {
  it("grants a new token after enough simulated time has passed for one refill", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1 }, clock.now);

    expect(limiter.checkAndConsume("client-c").allowed).toBe(true);
    expect(limiter.checkAndConsume("client-c").allowed).toBe(true);
    // Bucket empty now.
    expect(limiter.checkAndConsume("client-c").allowed).toBe(false);

    // Advance 1 full second -> 1 token refilled at refillPerSecond: 1.
    clock.advance(1000);
    const afterRefill = limiter.checkAndConsume("client-c");
    expect(afterRefill.allowed).toBe(true);

    // Immediately after consuming that refilled token, should block again.
    expect(limiter.checkAndConsume("client-c").allowed).toBe(false);
  });

  it("never refills past capacity even after a very long idle period", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 5 }, clock.now);

    limiter.checkAndConsume("client-d"); // consume 1, 1 left
    clock.advance(1_000_000); // huge idle gap
    // Bucket should cap at capacity (2), not accumulate unbounded tokens.
    expect(limiter.checkAndConsume("client-d").allowed).toBe(true);
    expect(limiter.checkAndConsume("client-d").allowed).toBe(true);
    expect(limiter.checkAndConsume("client-d").allowed).toBe(false);
  });

  it("is deterministic: identical clock sequences produce identical allow/deny sequences", () => {
    const runOnce = () => {
      const clock = fakeClock(0);
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1 }, clock.now);
      const results: boolean[] = [];
      results.push(limiter.checkAndConsume("client-e").allowed);
      results.push(limiter.checkAndConsume("client-e").allowed);
      results.push(limiter.checkAndConsume("client-e").allowed);
      clock.advance(500);
      results.push(limiter.checkAndConsume("client-e").allowed);
      clock.advance(500);
      results.push(limiter.checkAndConsume("client-e").allowed);
      return results;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe("TokenBucketRateLimiter — per-key isolation", () => {
  it("tracks separate buckets per client key so one client's exhaustion doesn't affect another", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1 }, clock.now);

    expect(limiter.checkAndConsume("client-f").allowed).toBe(true);
    expect(limiter.checkAndConsume("client-f").allowed).toBe(false);
    // Different key, untouched bucket.
    expect(limiter.checkAndConsume("client-g").allowed).toBe(true);
  });
});

describe("TokenBucketRateLimiter — pruning stale entries", () => {
  it("prune() removes buckets that have been full and untouched past the given staleness window", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1 }, clock.now);

    limiter.checkAndConsume("client-h");
    expect(limiter.size()).toBe(1);

    clock.advance(10_000);
    limiter.prune(5_000); // anything untouched for >5s and fully refilled gets pruned
    expect(limiter.size()).toBe(0);
  });

  it("does not prune buckets that are still partially consumed and within the staleness window", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1 }, clock.now);

    limiter.checkAndConsume("client-i");
    clock.advance(1_000);
    limiter.prune(5_000);
    expect(limiter.size()).toBe(1);
  });
});

describe("TokenBucketRateLimiter — retryAfterSeconds accuracy", () => {
  it("reports a retryAfterSeconds consistent with the configured refill rate", () => {
    const clock = fakeClock(0);
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 0.5 }, clock.now);

    expect(limiter.checkAndConsume("client-j").allowed).toBe(true);
    const blocked = limiter.checkAndConsume("client-j");
    expect(blocked.allowed).toBe(false);
    // At 0.5 tokens/sec, waiting for 1 token takes ~2 seconds.
    expect(blocked.retryAfterSeconds).toBeCloseTo(2, 0);
  });
});
