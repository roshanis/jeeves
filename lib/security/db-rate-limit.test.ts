import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { DbTokenBucketRateLimiter } from "./db-rate-limit";

/**
 * Shared-store rate limiting (docs/production-readiness.md §1.2).
 *
 * The in-memory TokenBucketRateLimiter keeps buckets in a module-scoped Map,
 * so on a serverless fan-out each instance has its own allowance: a caller
 * gets a fresh bucket by landing on a different instance, and a cold start
 * resets it. The passcode brute-force gate on POST /api/session — 5 attempts
 * refilling at 1/30s — was therefore 5 attempts PER WARM INSTANCE.
 *
 * The decisive test here is "two independent limiter instances over one
 * database share a single allowance", which is what the Map could never do.
 */
describe("DbTokenBucketRateLimiter", () => {
  let db: TestDb;
  let clock: number;
  const now = () => clock;

  beforeEach(async () => {
    db = await createTestDb();
    clock = 1_000_000;
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  function limiter(capacity = 5, refillPerSecond = 1 / 30) {
    return new DbTokenBucketRateLimiter({ capacity, refillPerSecond }, () => db, now);
  }

  it("allows up to capacity, then denies", async () => {
    const rl = limiter(3, 0);

    expect((await rl.checkAndConsume("a")).allowed).toBe(true);
    expect((await rl.checkAndConsume("a")).allowed).toBe(true);
    expect((await rl.checkAndConsume("a")).allowed).toBe(true);
    expect((await rl.checkAndConsume("a")).allowed).toBe(false);
  });

  it("SHARES one allowance across separate limiter instances — the whole point", async () => {
    const instanceA = limiter(3, 0);
    const instanceB = limiter(3, 0);

    // Spend the budget from "instance A".
    expect((await instanceA.checkAndConsume("shared")).allowed).toBe(true);
    expect((await instanceA.checkAndConsume("shared")).allowed).toBe(true);
    expect((await instanceA.checkAndConsume("shared")).allowed).toBe(true);

    // A request that lands on "instance B" must NOT get a fresh bucket.
    expect((await instanceB.checkAndConsume("shared")).allowed).toBe(false);
  });

  it("keys are independent of one another", async () => {
    const rl = limiter(1, 0);

    expect((await rl.checkAndConsume("client-1")).allowed).toBe(true);
    expect((await rl.checkAndConsume("client-1")).allowed).toBe(false);
    expect((await rl.checkAndConsume("client-2")).allowed).toBe(true);
  });

  it("refills over time at the configured rate", async () => {
    const rl = limiter(2, 1); // 1 token per second

    expect((await rl.checkAndConsume("r")).allowed).toBe(true);
    expect((await rl.checkAndConsume("r")).allowed).toBe(true);
    expect((await rl.checkAndConsume("r")).allowed).toBe(false);

    clock += 1000; // one token back
    expect((await rl.checkAndConsume("r")).allowed).toBe(true);
    expect((await rl.checkAndConsume("r")).allowed).toBe(false);
  });

  it("never refills beyond capacity", async () => {
    const rl = limiter(2, 1);

    clock += 10_000_000; // an age
    expect((await rl.checkAndConsume("c")).allowed).toBe(true);
    expect((await rl.checkAndConsume("c")).allowed).toBe(true);
    expect((await rl.checkAndConsume("c")).allowed).toBe(false);
  });

  it("reports how long to wait when denied", async () => {
    const rl = limiter(1, 0.5); // one token per 2s

    expect((await rl.checkAndConsume("w")).allowed).toBe(true);
    const denied = await rl.checkAndConsume("w");

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(2);
  });

  it("does not consume a token on a denied request", async () => {
    const rl = limiter(1, 1);

    await rl.checkAndConsume("d");
    await rl.checkAndConsume("d"); // denied
    await rl.checkAndConsume("d"); // denied

    // After exactly one second, exactly one token is available — if denials
    // had driven the balance negative this would still be refused.
    clock += 1000;
    expect((await rl.checkAndConsume("d")).allowed).toBe(true);
  });

  it("prunes only buckets that are full AND idle", async () => {
    const rl = limiter(2, 1);

    await rl.checkAndConsume("idle-but-spent");
    await rl.checkAndConsume("idle-but-spent"); // now empty
    await rl.checkAndConsume("untouched-since");

    clock += 500; // not yet stale
    expect(await rl.prune(10_000)).toBe(0);

    clock += 20_000; // both idle; both have refilled to capacity by now
    expect(await rl.prune(10_000)).toBe(2);
  });

  it("survives a concurrent burst without handing out more than capacity", async () => {
    const rl = limiter(5, 0);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => rl.checkAndConsume("burst")),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
