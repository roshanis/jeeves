import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { initiatives, reviewCycles, reviewDecisions, reviewNotifications } from "@/lib/db/schema";
import { TRIAGE_READY_CHAMPION_PAYLOAD } from "../../tests/fixtures/triage-ready-intake";
import type { Actor } from "@/lib/domain/types";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const svc = await import("./initiative-service");
const {
  recentUndeliveredNotifications,
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
        ? { ...TRIAGE_READY_CHAMPION_PAYLOAD, basics: { ...TRIAGE_READY_CHAMPION_PAYLOAD.basics, title } }
        : TRIAGE_READY_CHAMPION_PAYLOAD,
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

  // Nothing is delivered in these tests, so every recorded ask is undelivered.
  const allNotifications = () => testDb.select().from(reviewNotifications);

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

      const asAlpha = await recentUndeliveredNotifications(testDb, "ws_alpha");
      expect(idsOf(asAlpha.rows)).toEqual(new Set([alpha, shared]));

      const asBravo = await recentUndeliveredNotifications(testDb, "ws_bravo");
      expect(idsOf(asBravo.rows)).toEqual(new Set([bravo, shared]));
    });

    it("never carries another workspace's initiative title in a subject or body", async () => {
      await threeInitiatives();
      const asAlpha = await recentUndeliveredNotifications(testDb, "ws_alpha");
      const text = asAlpha.rows.map((n) => `${n.subject} ${n.body}`).join(" ");

      expect(text).toContain("Alpha Ward Copilot");
      expect(text).not.toContain("Bravo Ward Copilot");
    });

    it("shows a viewer with no workspace only the shared examples", async () => {
      const { shared } = await threeInitiatives();
      for (const viewer of [null, "ws_unknown"] as const) {
        const { rows } = await recentUndeliveredNotifications(testDb, viewer);
        expect(idsOf(rows)).toEqual(new Set([shared]));
        expect(rows.every((n) => n.deliveredAt === null)).toBe(true);
      }
    });

    it("lists the newest asks first", async () => {
      await threeInitiatives();
      const { rows } = await recentUndeliveredNotifications(testDb, "ws_alpha");
      const times = rows.map((n) => n.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("counts only what the viewer may see, so the total gives nothing away", async () => {
      await threeInitiatives();
      const everything = (await allNotifications()).length;
      const asAlpha = await recentUndeliveredNotifications(testDb, "ws_alpha");
      const asNobody = await recentUndeliveredNotifications(testDb, null);

      expect(asAlpha.total).toBe(asAlpha.rows.length);
      expect(asNobody.total).toBe(asNobody.rows.length);
      expect(asAlpha.total).toBeGreaterThan(asNobody.total);
      expect(asAlpha.total).toBeLessThan(everything);
    });

  });

  // L32: a request is on the panel only while its review still needs a
  // human and its cycle is open.
  describe("the panel lists only reviews still outstanding in an open cycle", () => {
    it("drops the request for a signed review, and keeps the others", async () => {
      const id = await championReadyToTriage();
      await svc.triage(testDb, id, SYSTEM, null);
      const before = await recentUndeliveredNotifications(testDb, null);
      const [review] = await testDb.select().from(reviewDecisions).where(eq(reviewDecisions.domain, "legal"));
      await testDb.update(reviewDecisions).set({ status: "signed" }).where(eq(reviewDecisions.id, review!.id));

      const after = await recentUndeliveredNotifications(testDb, null);
      expect(after.rows.some((r) => r.domain === "legal")).toBe(false);
      expect(after.rows).toHaveLength(before.rows.length - 1);
      expect(after.total).toBe(before.total - 1);
    });

    it("drops the request for a review that abstained", async () => {
      const id = await championReadyToTriage();
      await svc.triage(testDb, id, SYSTEM, null);
      await testDb.update(reviewDecisions).set({ status: "abstained" }).where(eq(reviewDecisions.domain, "legal"));
      expect((await recentUndeliveredNotifications(testDb, null)).rows.some((r) => r.domain === "legal")).toBe(false);
    });

    it("keeps the request for a drafted review", async () => {
      const id = await championReadyToTriage();
      await svc.triage(testDb, id, SYSTEM, null);
      await testDb.update(reviewDecisions).set({ status: "drafted" }).where(eq(reviewDecisions.domain, "legal"));
      expect((await recentUndeliveredNotifications(testDb, null)).rows.some((r) => r.domain === "legal")).toBe(true);
    });

    it("drops every request of a cycle once it closes", async () => {
      const id = await championReadyToTriage();
      const res = await svc.triage(testDb, id, SYSTEM, null);
      expect((await recentUndeliveredNotifications(testDb, null)).total).toBeGreaterThan(0);
      await testDb.update(reviewCycles).set({ closedAt: new Date() }).where(eq(reviewCycles.id, res.cycleId!));
      expect(await recentUndeliveredNotifications(testDb, null)).toEqual({ rows: [], total: 0 });
    });

    it("keeps workspace scoping when the review filter applies", async () => {
      const alpha = await championReadyToTriage("ws_alpha", "Alpha Ward Copilot");
      const bravo = await championReadyToTriage("ws_bravo", "Bravo Ward Copilot");
      await svc.triage(testDb, alpha, SYSTEM, "ws_alpha");
      await svc.triage(testDb, bravo, SYSTEM, "ws_bravo");
      await testDb.update(reviewDecisions).set({ status: "signed" }).where(eq(reviewDecisions.domain, "legal"));
      const asAlpha = await recentUndeliveredNotifications(testDb, "ws_alpha");
      expect(new Set(asAlpha.rows.map((r) => r.initiativeId))).toEqual(new Set([alpha]));
      expect(asAlpha.rows.some((r) => r.domain === "legal")).toBe(false);
      expect(asAlpha.total).toBe(asAlpha.rows.length);
    });
  });

  it("no longer exports unscoped readers", async () => {
    const mod = await import("./notification-service");
    expect(mod).not.toHaveProperty("pendingNotificationsForDomain");
    expect(mod).not.toHaveProperty("undeliveredNotifications");
  });

  it("shows the newest 50 undelivered requests first, with the total", async () => {
    const id = await championReadyToTriage();
    await svc.triage(testDb, id, SYSTEM, null);
    const [seed] = await allNotifications();
    await testDb.insert(reviewNotifications).values(
      Array.from({ length: 60 }, (_, i) => ({
        id: `bulk-${i}`,
        initiativeId: seed!.initiativeId,
        cycleId: seed!.cycleId,
        domain: seed!.domain,
        kind: `bulk_${i}`,
        subject: `bulk ${i}`,
        body: "b",
        createdAt: new Date(Date.UTC(2030, 0, 1, 0, i)),
      })),
    );
    const all = await allNotifications();
    const { rows, total } = await recentUndeliveredNotifications(testDb, null);
    expect(total).toBe(all.length);
    expect(rows).toHaveLength(50);
    expect(rows[0]!.id).toBe("bulk-59");
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[49]!.createdAt.getTime());
  });

  it("lists and counts only requests the viewer's workspace may see", async () => {
    const mine = await championReadyToTriage();
    await svc.triage(testDb, mine, SYSTEM, null);
    const [seed] = await allNotifications();
    const foreign = {
      ...seed!,
      id: "foreign-1",
      kind: "foreign_kind",
      subject: "Foreign review requested: Secret title",
    };
    const other = (await testDb.select().from(initiatives).where(eq(initiatives.id, mine)))[0]!;
    await testDb.insert(initiatives).values({
      ...other,
      id: "init-foreign",
      slug: "init-foreign",
      workspaceId: "ws-B",
    });
    await testDb.insert(reviewNotifications).values({ ...foreign, initiativeId: "init-foreign" });
    await testDb.update(initiatives).set({ workspaceId: "ws-A" }).where(eq(initiatives.id, mine));

    const asA = await recentUndeliveredNotifications(testDb, "ws-A");
    expect(asA.rows.some((r) => r.id === "foreign-1")).toBe(false);
    expect(asA.total).toBe(asA.rows.length);
    expect(asA.total).toBeGreaterThan(0);
    const asNone = await recentUndeliveredNotifications(testDb, null);
    expect(asNone.rows.some((r) => r.id === "foreign-1")).toBe(false);
    expect(asNone.total).toBe(0);
    const asB = await recentUndeliveredNotifications(testDb, "ws-B");
    expect(asB.rows.map((r) => r.id)).toEqual(["foreign-1"]);
    expect(asB.total).toBe(1);
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
