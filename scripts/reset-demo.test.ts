// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../lib/db/test-client";
import { resetDemo } from "./reset-demo";
import { seedDatabase } from "./seed";
import { initiatives, rateLimitBuckets, runBudget, runBudgetWorkspace, sessions } from "../lib/db/schema";

describe("scripts/reset-demo.ts", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await seedDatabase(db);
    await db.insert(sessions).values({ token: "t1", personaKey: "requester", workspaceId: "w1", expiresAt: Date.now() + 1000 });
    await db.insert(rateLimitBuckets).values({ key: "session:abc", tokens: 0, lastRefillMs: 1, lastTouchedMs: 1 });
    await db.insert(runBudgetWorkspace).values({ day: "2026-07-01", workspaceId: "w1", tokensUsed: 50_000 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeTestDb(db);
  });

  it("clears sessions, the daily budget and rate-limit buckets", async () => {
    await resetDemo(db);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(runBudget)).toHaveLength(0);
    expect(await db.select().from(runBudgetWorkspace)).toHaveLength(0);
    expect(await db.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await db.select().from(initiatives)).toHaveLength(12);
  });

  it("rolls the seed and the live-state deletes back together when a step fails", async () => {
    await db.delete(runBudget);
    await db.$client.exec("DROP TABLE rate_limit_buckets");
    await expect(resetDemo(db)).rejects.toThrow();
    // sessions survive and the seed's own wipe/re-insert did not commit
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(await db.select().from(runBudget)).toHaveLength(0);
  });

  it("sets a lock_timeout inside the seed transaction", async () => {
    let seen = "";
    await seedDatabase(db, async (tx) => {
      const r = await tx.execute("SHOW lock_timeout");
      seen = JSON.stringify((r as { rows: unknown[] }).rows);
    });
    expect(seen).toContain("10s");
  });
});
