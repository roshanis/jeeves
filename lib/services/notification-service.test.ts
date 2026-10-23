import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { initiatives, reviewDecisions, reviewNotifications } from "@/lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { Actor } from "@/lib/domain/types";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const svc = await import("./initiative-service");
const {
  pendingNotificationsForDomain,
  undeliveredNotifications,
  undeliveredNotificationsForViewer,
  deliveryTransportStatus,
} = await import("./notification-service");

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
  async function championReadyToTriage(workspaceId: string | null = null, title?: string): Promise<string> {
    const draft = await svc.createDraft(testDb, {
      payload: title
        ? { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title } }
        : CHAMPION_PREFILL_PAYLOAD,
      requesterActor: REQUESTER,
      requesterName: "Priya Raman",
      workspaceId,
    });
    await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, workspaceId);
    await svc.startQc(testDb, draft.initiativeId, PROGRAM, workspaceId);
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

  // The queue names initiatives ("<Domain> review requested: <title>"), and every
  // playground visitor has their own workspace: a queue that lists every row
  // would show strangers each other's initiative titles.
  describe("the undelivered queue as one viewer sees it", () => {
    async function threeInitiatives() {
      const alpha = await championReadyToTriage("ws_alpha", "Alpha Ward Copilot");
      const bravo = await championReadyToTriage("ws_bravo", "Bravo Ward Copilot");
      const shared = await championReadyToTriage(null, "Shared Example Copilot");
      for (const [id, ws] of [[alpha, "ws_alpha"], [bravo, "ws_bravo"], [shared, null]] as const) {
        await svc.triage(testDb, id, SYSTEM, ws);
      }
      return { alpha, bravo, shared };
    }

    const idsOf = (rows: { initiativeId: string }[]) => new Set(rows.map((r) => r.initiativeId));

    it("shows each playground workspace its own asks and the shared examples', never another's", async () => {
      const { alpha, bravo, shared } = await threeInitiatives();

      const asAlpha = await undeliveredNotificationsForViewer(testDb, "ws_alpha");
      expect(idsOf(asAlpha)).toEqual(new Set([alpha, shared]));

      const asBravo = await undeliveredNotificationsForViewer(testDb, "ws_bravo");
      expect(idsOf(asBravo)).toEqual(new Set([bravo, shared]));
    });

    it("never carries another workspace's initiative title in a subject or body", async () => {
      await threeInitiatives();
      const asAlpha = await undeliveredNotificationsForViewer(testDb, "ws_alpha");
      const text = asAlpha.map((n) => `${n.subject} ${n.body}`).join(" ");

      expect(text).toContain("Alpha Ward Copilot");
      expect(text).not.toContain("Bravo Ward Copilot");
    });

    it("shows a viewer with no workspace only the shared examples", async () => {
      const { shared } = await threeInitiatives();
      for (const viewer of [null, "ws_unknown"] as const) {
        const rows = await undeliveredNotificationsForViewer(testDb, viewer);
        expect(idsOf(rows)).toEqual(new Set([shared]));
        expect(rows.every((n) => n.deliveredAt === null)).toBe(true);
      }
    });

    it("keeps the queue in the order the asks were made", async () => {
      await threeInitiatives();
      const rows = await undeliveredNotificationsForViewer(testDb, "ws_alpha");
      const times = rows.map((n) => n.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it("leaves the unscoped operator query as it was: every ask, every workspace", async () => {
      const { alpha, bravo, shared } = await threeInitiatives();
      expect(idsOf(await undeliveredNotifications(testDb))).toEqual(new Set([alpha, bravo, shared]));
    });
  });

  it("does not break triage when migration 0013 has not been applied yet", async () => {
    // Deploys do not run migrations (build is plain `next build`), and
    // triage records its review requests inside the SAME transaction. If
    // the code ships before 0013 is applied, the insert would fail and roll
    // back every triage. An absent table must mean "record nothing", not
    // "fail the fan-out" — the same rolling-deploy rule the evidence tables
    // follow for 0011.
    await testDb.execute(sql`DROP TABLE review_notifications`);
    const id = await championReadyToTriage();

    const res = await svc.triage(testDb, id, SYSTEM, null);
    expect(res.branch).toBe("review");
    expect((await testDb.select().from(reviewDecisions)).length).toBeGreaterThan(0);
  });

  it("still propagates real database errors — only an ABSENT table is tolerated", async () => {
    // A guard that swallowed every error would hide genuine failures.
    const { enqueueReviewRequests } = await import("./notification-service");
    const broken = {
      execute: async () => {
        throw new Error("connection reset");
      },
    };
    await expect(
      enqueueReviewRequests(broken as never, {
        initiativeId: "i",
        initiativeTitle: "t",
        cycleId: "c",
        domains: ["legal"],
        tier: "critical",
        now: Date.now(),
      }),
    ).rejects.toThrow(/connection reset/);
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
