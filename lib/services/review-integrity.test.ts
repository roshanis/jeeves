import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { initiatives, reviewCycles } from "../db/schema";
import { lockCurrentReviewCycle, type ReviewTx } from "./review-integrity";

describe("lockCurrentReviewCycle workspace check", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  // Records every FOR UPDATE issued through the transaction.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function withLockRecorder(tx: any, locks: string[]): ReviewTx {
    const realSelect = tx.select.bind(tx);
    tx.select = (...a: unknown[]) => {
      const wrap = (b: any): any =>
        new Proxy(b, {
          get(t, k) {
            const v = t[k];
            if (typeof v !== "function") return v;
            return (...args: unknown[]) => {
              if (k === "for") locks.push(String(args[0]));
              const r = v.apply(t, args);
              return r && typeof r === "object" && k !== "then" ? wrap(r) : r;
            };
          },
        });
      return wrap(realSelect(...a));
    };
    return tx;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  async function inReviewCycle() {
    const [init] = await db.select().from(initiatives).where(eq(initiatives.state, "in_review"));
    const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, init!.id));
    return { init: init!, cycle: cycle! };
  }

  it("refuses a caller from another workspace without taking the initiative's row lock", async () => {
    const { init, cycle } = await inReviewCycle();
    expect(init.workspaceId).toBeNull();
    const locks: string[] = [];
    await expect(
      db.transaction((tx) => lockCurrentReviewCycle(withLockRecorder(tx, locks), cycle.id, "ws-visitor")),
    ).rejects.toMatchObject({ name: "ReviewIntegrityError", kind: "not_found" });
    expect(locks).toEqual([]);
  });

  it("still locks the row for a caller whose workspace matches", async () => {
    const { init, cycle } = await inReviewCycle();
    await db.update(initiatives).set({ workspaceId: "ws-owner" }).where(eq(initiatives.id, init.id));
    const locks: string[] = [];
    const result = await db.transaction((tx) =>
      lockCurrentReviewCycle(withLockRecorder(tx, locks), cycle.id, "ws-owner"),
    );
    expect(result.cycle.id).toBe(cycle.id);
    expect(locks).toEqual(["update"]);
  });
});
