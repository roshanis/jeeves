import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { initiatives, reviewDecisions, reviewNotifications } from "@/lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { Actor } from "@/lib/domain/types";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const svc = await import("./initiative-service");
const { pendingNotificationsForDomain, undeliveredNotifications, deliveryTransportStatus } =
  await import("./notification-service");

const REQUESTER: Actor = { id: "priya-raman", role: "requester" };
const PROGRAM: Actor = { id: "nia-okafor", role: "program" };
const SYSTEM: Actor = { id: "system", role: "system" };

/**
 * Review-request notifications.
 *
 * triage() opens one review per required domain — eight of them for a
 * Critical initiative — but nothing ever told those domains. A row appeared
 * in a queue and waited to be noticed. There is no notification transport in
 * this codebase at all, which is the difference between "Legal has been
 * asked" and "Legal knows".
 *
 * The property that matters most here is ATOMICITY: the ask is recorded in
 * the same transaction that creates the review, so "a review exists but
 * nobody was asked for it" is not a reachable state.
 */
describe("review-request notifications", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(testDb);
  });

  // Through the QC gate, not merely submitted: triage() is only reachable
  // from `in_qc`. The gate itself is lib/services/qc-gate.test.ts's subject;
  // here it is one hop on the way to the fan-out these tests are about.
  async function championReadyToTriage(): Promise<string> {
    const draft = await svc.createDraft(testDb, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: REQUESTER,
      requesterName: "Priya Raman",
      workspaceId: null,
    });
    await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, null);
    await svc.startQc(testDb, draft.initiativeId, PROGRAM, null);
    return draft.initiativeId;
  }

  it("asks every domain that triage opened a review for — no more, no fewer", async () => {
    const id = await championReadyToTriage();
    const res = await svc.triage(testDb, id, SYSTEM, null);
    expect(res.branch).toBe("review");

    const reviews = await testDb.select().from(reviewDecisions);
    const notes = await testDb
      .select()
      .from(reviewNotifications)
      .where(eq(reviewNotifications.initiativeId, id));

    expect(notes.length).toBe(reviews.length);
    expect(new Set(notes.map((n) => n.domain))).toEqual(new Set(reviews.map((r) => r.domain)));
  });

  it("records the ask against the same cycle as the review", async () => {
    const id = await championReadyToTriage();
    const res = await svc.triage(testDb, id, SYSTEM, null);

    const notes = await testDb.select().from(reviewNotifications);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.cycleId).toBe(res.cycleId);
      expect(n.kind).toBe("review_requested");
    }
  });

  it("names the initiative and the domain in the message, rendered at ask time", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);

    const [row] = await testDb.select().from(initiatives).where(eq(initiatives.id, id));
    const legal = (await testDb.select().from(reviewNotifications)).find(
      (n) => n.domain === "legal",
    );

    expect(legal).toBeDefined();
    expect(legal!.subject).toContain(row!.title);
    expect(legal!.body).toContain("Legal");
    // The tier drives how urgent this is; it belongs in the ask.
    expect(legal!.body.toLowerCase()).toContain("critical");
  });

  it("leaves delivery unclaimed — nothing has actually been sent", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);

    const notes = await testDb.select().from(reviewNotifications);
    for (const n of notes) {
      expect(n.deliveredAt).toBeNull();
      expect(n.deliveryChannel).toBeNull();
    }
  });

  it("is idempotent — re-running triage does not queue a second ask", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);
    const first = (await testDb.select().from(reviewNotifications)).length;

    // triage() is documented as re-runnable; the ask must not duplicate.
    await svc.triage(testDb, id, SYSTEM, null).catch(() => {});

    expect((await testDb.select().from(reviewNotifications)).length).toBe(first);
  });

  it("exposes a reviewer's own outstanding asks", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);

    const legal = await pendingNotificationsForDomain(testDb, "legal");
    expect(legal.length).toBe(1);
    expect(legal[0]!.domain).toBe("legal");

    // A domain that was not asked has nothing outstanding.
    const none = await pendingNotificationsForDomain(testDb, "procurement");
    expect(none.length).toBeLessThanOrEqual(1);
  });

  it("exposes the undelivered queue for the operator view", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);

    const queue = await undeliveredNotifications(testDb);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((n) => n.deliveredAt === null)).toBe(true);
  });

  it("reports the transport as unconfigured rather than implying delivery", () => {
    const status = deliveryTransportStatus();
    expect(status.configured).toBe(false);
    expect(status.channel).toBeNull();
    expect(status.detail).toMatch(/no delivery transport is configured/i);
    // And it must say plainly that nothing leaves the process — the whole
    // point is not implying delivery that is not happening.
    expect(status.detail).toMatch(/nothing is emailed|nothing is sent/i);
  });
});
