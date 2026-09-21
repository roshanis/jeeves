// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { initiativeDecisions, reviewCycles, reviewDecisions } from "../db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { createMockAgentPort } from "../agents/mock-adapter";
import { createDraft, submitIntake, triage, decide } from "../services/initiative-service";
import { startDraftRun } from "../workflow/review-run";
import { DbDataProvider } from "./db-provider";

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await closeTestDb(db); });

it("uses the same descending cycle ID for equal timestamps in drafting, projection and approval", async () => {
  const requester = { id: "priya-raman", role: "requester" as const };
  const { initiativeId, slug } = await createDraft(db, {
    payload: CHAMPION_PREFILL_PAYLOAD, requesterActor: requester, requesterName: "Priya Raman",
  });
  await submitIntake(db, initiativeId, requester);
  const triaged = await triage(db, initiativeId);
  if (triaged.branch !== "review") throw new Error("review branch required");
  const [original] = await db.select().from(reviewCycles).where(eq(reviewCycles.id, triaged.cycleId));
  const selectedCycleId = "zz-cycle-equal-timestamp";
  await db.insert(reviewCycles).values({ ...original, id: selectedCycleId });

  // Fan-out already orders ties by id descending. The old cycle stays pending.
  const run = await startDraftRun(db, initiativeId, triaged.requiredDomains, createMockAgentPort());
  expect(run.cycleId).toBe(selectedCycleId);
  await db.update(reviewDecisions).set({ status: "signed", reviewer: "test-reviewer", signedAt: new Date() })
    .where(eq(reviewDecisions.cycleId, selectedCycleId));

  const detail = (await new DbDataProvider(db).getInitiativeDetail(slug))!;
  expect.soft(detail.reviews.every((review) => review.cycleId === selectedCycleId)).toBe(true);
  expect.soft(detail.summary.decisionReadiness?.canApprove).toBe(true);
  await decide(db, initiativeId, { id: "angela-torres", role: "approver" }, null, { decision: "approved" });
  const [decision] = await db.select().from(initiativeDecisions).where(eq(initiativeDecisions.initiativeId, initiativeId));
  expect(decision.cycleId).toBe(selectedCycleId);
});
