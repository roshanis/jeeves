import { describe, expect, it } from "vitest";
import { InMemoryBudgetStore, checkBudget, reserve } from "./budget";

const DAY = "2026-07-10";

describe("InMemoryBudgetStore — basic get/add", () => {
  it("returns 0 usage for a day with no recorded usage", async () => {
    const store = new InMemoryBudgetStore();
    expect(await store.getUsed(DAY)).toBe(0);
  });

  it("accumulates usage across multiple addUsage calls for the same day", async () => {
    const store = new InMemoryBudgetStore();
    await store.addUsage(DAY, 100);
    await store.addUsage(DAY, 250);
    expect(await store.getUsed(DAY)).toBe(350);
  });

  it("tracks usage independently per day", async () => {
    const store = new InMemoryBudgetStore();
    await store.addUsage(DAY, 100);
    await store.addUsage("2026-07-11", 999);
    expect(await store.getUsed(DAY)).toBe(100);
    expect(await store.getUsed("2026-07-11")).toBe(999);
  });
});

describe("checkBudget — non-atomic read-only preview", () => {
  it("grants when used + requested is within the daily cap", async () => {
    const store = new InMemoryBudgetStore();
    await store.addUsage(DAY, 500);
    const result = await checkBudget(store, DAY, 200, 1000);
    expect(result.granted).toBe(true);
    // `remaining` reflects current unused budget (dailyCap - used = 500),
    // not a post-request projection.
    expect(result.remaining).toBe(500);
  });

  it("denies when used + requested would exceed the daily cap", async () => {
    const store = new InMemoryBudgetStore();
    await store.addUsage(DAY, 900);
    const result = await checkBudget(store, DAY, 200, 1000);
    expect(result.granted).toBe(false);
    expect(result.remaining).toBe(100);
  });

  it("grants exactly at the cap boundary (used + requested === cap)", async () => {
    const store = new InMemoryBudgetStore();
    await store.addUsage(DAY, 900);
    const result = await checkBudget(store, DAY, 100, 1000);
    expect(result.granted).toBe(true);
    // `remaining` reflects current unused budget (dailyCap - used), not a
    // post-request projection — see `BudgetCheckResult.remaining` doc.
    expect(result.remaining).toBe(100);
  });
});

describe("reserve — atomic reservation semantics", () => {
  it("grants a reservation and records the usage atomically when within cap", async () => {
    const store = new InMemoryBudgetStore();
    const result = await reserve(store, DAY, 300, 1000);
    expect(result.granted).toBe(true);
    expect(await store.getUsed(DAY)).toBe(300);
  });

  it("denies a reservation that would exceed the cap and does not record any usage", async () => {
    const store = new InMemoryBudgetStore();
    await reserve(store, DAY, 900, 1000);
    const denied = await reserve(store, DAY, 200, 1000);
    expect(denied.granted).toBe(false);
    // Usage should remain exactly at 900 — the denied reservation must not
    // have been partially or fully committed.
    expect(await store.getUsed(DAY)).toBe(900);
  });

  it("sequential reservations across two calls never double-count", async () => {
    const store = new InMemoryBudgetStore();
    const first = await reserve(store, DAY, 400, 1000);
    const second = await reserve(store, DAY, 400, 1000);
    expect(first.granted).toBe(true);
    expect(second.granted).toBe(true);
    expect(await store.getUsed(DAY)).toBe(800);
  });
});

describe("reserve — concurrency: parallel reserves must never over-commit the cap", () => {
  it("20 parallel reserves of 100 tokens against a cap of 1000 grant exactly 10 and total exactly 1000", async () => {
    const store = new InMemoryBudgetStore();
    const cap = 1000;
    const perRequest = 100;
    const parallelCount = 20;

    const results = await Promise.all(
      Array.from({ length: parallelCount }, () => reserve(store, DAY, perRequest, cap)),
    );

    const grantedCount = results.filter((r) => r.granted).length;
    const deniedCount = results.filter((r) => !r.granted).length;
    const finalUsed = await store.getUsed(DAY);

    expect(finalUsed).toBeLessThanOrEqual(cap);
    expect(finalUsed).toBe(grantedCount * perRequest);
    expect(grantedCount).toBe(10);
    expect(deniedCount).toBe(10);
  });

  it("a different day's budget is unaffected by concurrent reserves on this day", async () => {
    const store = new InMemoryBudgetStore();
    const otherDay = "2026-07-09";
    await store.addUsage(otherDay, 500);

    await Promise.all(
      Array.from({ length: 20 }, () => reserve(store, DAY, 100, 1000)),
    );

    expect(await store.getUsed(otherDay)).toBe(500);
  });
});
