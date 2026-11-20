// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { runBudget, runBudgetWorkspace } from "../db/schema";
import { DAILY_TOKEN_CAP, WORKSPACE_DAILY_TOKEN_CAP, reserveForWorkspace } from "./budget";

const DAY = "2099-02-01";
let db: TestDb;

beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await closeTestDb(db); });

async function workspaceUsed(workspaceId: string, day = DAY): Promise<number> {
  const rows = await db.select().from(runBudgetWorkspace).where(eq(runBudgetWorkspace.workspaceId, workspaceId));
  return rows.find((row) => row.day === day)?.tokensUsed ?? 0;
}
async function globalUsed(day = DAY): Promise<number> {
  const [row] = await db.select().from(runBudget).where(eq(runBudget.day, day));
  return row?.tokensUsed ?? 0;
}

describe("per-workspace share of the daily model budget", () => {
  it("is 10 percent of the daily cap", () => {
    expect(WORKSPACE_DAILY_TOKEN_CAP).toBe(Math.floor(DAILY_TOKEN_CAP * 0.1));
    expect(WORKSPACE_DAILY_TOKEN_CAP).toBe(50_000);
  });

  it("stops one workspace at its share while another workspace can still reserve", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: 10_000 })).toEqual({ granted: true });
    }
    const refused = await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: 1 });
    expect(refused).toEqual({ granted: false, scope: "workspace", remaining: 0 });
    expect(await workspaceUsed("ws-a")).toBe(50_000);
    expect(await globalUsed()).toBe(50_000);

    expect(await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-b", tokens: 10_000 })).toEqual({ granted: true });
    expect(await globalUsed()).toBe(60_000);
  });

  it("still applies the global cap, and a refusal leaves the workspace row untouched", async () => {
    await db.insert(runBudget).values({ id: DAY, day: DAY, tokensUsed: DAILY_TOKEN_CAP - 5_000, tokensCap: DAILY_TOKEN_CAP });
    const refused = await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: 6_000 });
    expect(refused).toMatchObject({ granted: false, scope: "global" });
    expect(await workspaceUsed("ws-a")).toBe(0);
    expect(await globalUsed()).toBe(DAILY_TOKEN_CAP - 5_000);
  });

  it("refuses a single request larger than the workspace share without writing", async () => {
    const refused = await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: WORKSPACE_DAILY_TOKEN_CAP + 1 });
    expect(refused).toMatchObject({ granted: false, scope: "workspace" });
    expect(await globalUsed()).toBe(0);
    expect(await workspaceUsed("ws-a")).toBe(0);
  });

  it("tracks each UTC day separately", async () => {
    await reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: 50_000 });
    expect(await reserveForWorkspace(db, { day: "2099-02-02", workspaceId: "ws-a", tokens: 50_000 })).toEqual({ granted: true });
  });

  it("cannot overshoot under concurrent reservations in one workspace", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveForWorkspace(db, { day: DAY, workspaceId: "ws-a", tokens: 5_000 })),
    );
    expect(results.filter((r) => r.granted)).toHaveLength(10);
    expect(await workspaceUsed("ws-a")).toBe(50_000);
    expect(await globalUsed()).toBe(50_000);
  });
});
