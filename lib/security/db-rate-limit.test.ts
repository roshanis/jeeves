import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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

  it("peek reports the balance without writing", async () => {
    const rl = limiter(2, 0);
    expect(await rl.peek("p")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect((await db.execute(sql`select 1 from "rate_limit_buckets" where "key" = 'p'`)).rows).toHaveLength(0);

    await rl.checkAndConsume("p");
    await rl.checkAndConsume("p");
    const before = (await db.execute(sql`select "tokens", "last_refill_ms" from "rate_limit_buckets" where "key" = 'p'`)).rows;
    expect((await rl.peek("p")).allowed).toBe(false);
    expect((await rl.peek("p")).allowed).toBe(false);
    const after = (await db.execute(sql`select "tokens", "last_refill_ms" from "rate_limit_buckets" where "key" = 'p'`)).rows;
    expect(after).toEqual(before);

    const refilling = limiter(1, 1 / 30);
    await refilling.checkAndConsume("q");
    const denied = await refilling.peek("q");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    clock += 31_000;
    expect((await refilling.peek("q")).allowed).toBe(true);
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

  it("reports the wait in whole seconds, rounded up, the same from a denied consume and a peek", async () => {
    const rl = limiter(1, 1 / 30); // one token per 30s
    await rl.checkAndConsume("whole");

    clock += 7_300; // 22.7s still to wait
    expect(await rl.checkAndConsume("whole")).toEqual({ allowed: false, retryAfterSeconds: 23 });
    expect(await rl.peek("whole")).toEqual({ allowed: false, retryAfterSeconds: 23 });

    // 9s to wait, which the arithmetic gives as 9.000000000000002: still 9, not 10.
    clock += 13_700;
    expect(await rl.checkAndConsume("whole")).toEqual({ allowed: false, retryAfterSeconds: 9 });
    expect(await rl.peek("whole")).toEqual({ allowed: false, retryAfterSeconds: 9 });
  });

  it("counts the time until a refill stamp written by a faster clock is reached", async () => {
    const rl = limiter(1, 1 / 30);
    await rl.checkAndConsume("ahead"); // empty, stamped at 1_000_000
    clock -= 10_000; // this instance's clock runs 10s behind the one that wrote the stamp

    // No refill happens for 10s, then one token takes 30s more.
    expect(await rl.checkAndConsume("ahead")).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(await rl.peek("ahead")).toEqual({ allowed: false, retryAfterSeconds: 40 });
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

  it("a clock that steps backwards neither denies a funded bucket nor rewinds the refill stamp", async () => {
    const rl = limiter(3, 1 / 30);
    await rl.checkAndConsume("skew"); // 2 left, stamped at 1_000_000
    clock -= 30_000; // another instance's clock runs 30s behind
    expect((await rl.checkAndConsume("skew")).allowed).toBe(true);
    const rows = (await db.execute(sql`select "last_refill_ms" as t from "rate_limit_buckets" where "key" = 'skew'`)) as unknown as { rows?: { t: string | number }[] } | { t: string | number }[];
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(Number(list[0].t)).toBeGreaterThanOrEqual(1_000_000);
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
