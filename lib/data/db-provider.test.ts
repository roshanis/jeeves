import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { initiatives } from "../db/schema";
import { DbDataProvider } from "./db-provider";

/**
 * DataProvider contract tests against a REAL seeded PGlite database running
 * the real migrations — plan §8 test 10 (structured auditor queries) plus
 * the seed-spec §6/§7 read-model expectations.
 */
describe("lib/data/db-provider", () => {
  let db: TestDb;
  let provider: DbDataProvider;

  beforeAll(async () => {
    db = await createTestDb();
    await seedDatabase(db);
    provider = new DbDataProvider(db);
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  describe("listInitiatives", () => {
    it("returns all 12 seeded initiatives with tier/state/storyline", async () => {
      const rows = await provider.listInitiatives();
      expect(rows).toHaveLength(12);

      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      expect(bySlug.get("prior-auth-summarizer")).toMatchObject({
        state: "intake_draft",
        tier: "critical",
        storyline: "champion",
      });
      expect(bySlug.get("marketing-ab-tester")).toMatchObject({
        state: "deployed",
        tier: "low",
        storyline: "fast-lane",
        accountableApprover: "Angela Torres",
      });
      expect(bySlug.get("social-sentiment-miner")).toMatchObject({
        state: "rejected",
        storyline: "rejected",
      });
      expect(bySlug.get("member-chat-copilot")).toMatchObject({
        state: "deployed",
        storyline: "breach",
      });
      expect(bySlug.get("pa-correspondence-model")).toMatchObject({ storyline: "promotion" });
      expect(bySlug.get("claims-ocr-coder")).toMatchObject({ storyline: "self-hosted" });
      expect(bySlug.get("provider-dedup-agent")).toMatchObject({
        state: "in_review",
        storyline: "in-review",
        domainsRequired: 5,
        domainsSigned: 3,
      });
      expect(bySlug.get("nurse-triage-summarizer")).toMatchObject({
        state: "conditionally_approved",
        storyline: "conditional",
      });
      expect(bySlug.get("formulary-qa-bot")).toMatchObject({ storyline: "returned" });
      expect(bySlug.get("fwa-anomaly-detector")).toMatchObject({
        storyline: "overdue",
        overdue: true,
      });
      expect(bySlug.get("hr-resume-screener")).toMatchObject({ storyline: "exception" });
      expect(bySlug.get("callcenter-qa-scorer")).toMatchObject({ storyline: "healthy" });
    });
  });

  describe("getInitiativeDetail", () => {
    it("returns null for an unknown slug", async () => {
      expect(await provider.getInitiativeDetail("does-not-exist")).toBeNull();
    });

    it("champion (#1): unsubmitted intake with data.retentionIntent missing", async () => {
      const detail = await provider.getInitiativeDetail("prior-auth-summarizer");
      expect(detail).not.toBeNull();
      expect(detail!.intake).not.toBeNull();
      expect(detail!.intake!.submitted).toBe(false);
      expect(detail!.intake!.missing).toContain("data.retentionIntent");
      expect(detail!.intake!.fields).not.toHaveProperty("data.retentionIntent");
      expect(detail!.reviews).toHaveLength(0);
      expect(detail!.decisions).toHaveLength(0);
      expect(detail!.deployments).toHaveLength(0);
    });

    it("fast-lane (#2): decision carries FL-2026-01 citations and Angela Torres", async () => {
      const detail = await provider.getInitiativeDetail("marketing-ab-tester");
      expect(detail!.decisions).toHaveLength(1);
      const decision = detail!.decisions[0]!;
      expect(decision.type).toBe("fast_lane_approved");
      expect(decision.approver).toBe("Angela Torres");
      expect(decision.citations).toEqual(
        expect.arrayContaining(["FL-2.1", "FL-3", "FL-3.1", "FL-3.2", "FL-4"]),
      );
    });

    it("rejected (#3): decision cites the real MP-§ anchors from the policy corpus", async () => {
      const detail = await provider.getInitiativeDetail("social-sentiment-miner");
      expect(detail!.decisions).toHaveLength(1);
      const decision = detail!.decisions[0]!;
      expect(decision.type).toBe("rejected");
      expect(decision.citations).toEqual(
        expect.arrayContaining([
          "MP-H-5.1(b)",
          "MP-H-5.2",
          "MP-R-5.1(a)",
          "MP-R-5.2",
          "MP-L-6.1(b)",
          "MP-L-6.2",
        ]),
      );
      const signedReviews = detail!.reviews.filter((r) => r.status === "signed");
      expect(signedReviews.length).toBeGreaterThanOrEqual(3);
    });

    it("breach candidate (#4): 30-point eval series with the 0.08 threshold attached", async () => {
      const detail = await provider.getInitiativeDetail("member-chat-copilot");
      const evalSeries = detail!.telemetry.find((t) => t.kind === "eval_hallucination");
      expect(evalSeries).toBeTruthy();
      expect(evalSeries!.points).toHaveLength(30);
      expect(evalSeries!.threshold).toBe(0.08);
      const costSeries = detail!.telemetry.find((t) => t.kind === "cost_tokens_usd_day");
      expect(costSeries).toBeTruthy();
      expect(detail!.deployments).toEqual([
        expect.objectContaining({ version: "v1.2", status: "deployed" }),
      ]);
      const q01 = detail!.controls.find((c) => c.id === "Q-01");
      expect(q01).toBeTruthy();
      expect(q01!.threshold).toBe(0.08);
      expect(q01!.policySource).toBeNull(); // INDEX.md: Q-01 is not policy-cited
    });

    it("promotion (#5): v2.0 deployed and v2.1 awaiting_promotion_signoff", async () => {
      const detail = await provider.getInitiativeDetail("pa-correspondence-model");
      expect(detail!.deployments).toEqual([
        expect.objectContaining({ version: "v2.0", status: "deployed" }),
        expect.objectContaining({ version: "v2.1", status: "awaiting_promotion_signoff" }),
      ]);
      // Controls + telemetry attach to the operational deployment (v2.0).
      const evalSeries = detail!.telemetry.find((t) => t.kind === "eval_hallucination");
      expect(evalSeries).toBeTruthy();
      // Critical tier -> Q-01 default threshold 0.05 on the eval panel.
      expect(evalSeries!.threshold).toBe(0.05);
    });

    it("conditional (#8): 2 open conditions linked to C-01/C-02 with MP-C citations", async () => {
      const detail = await provider.getInitiativeDetail("nurse-triage-summarizer");
      expect(detail!.decisions).toHaveLength(1);
      const decision = detail!.decisions[0]!;
      expect(decision.type).toBe("conditionally_approved");
      expect(decision.approver).toBe("Angela Torres");
      expect(decision.conditions).toHaveLength(2);
      expect(decision.conditions.map((c) => c.controlId).sort()).toEqual(["C-01", "C-02"]);
      expect(decision.citations).toEqual(expect.arrayContaining(["MP-C-4.2", "MP-C-5.2"]));
    });

    it("returned (#9): RAI review returned by Sofia Grant with MP-R citations", async () => {
      const detail = await provider.getInitiativeDetail("formulary-qa-bot");
      const rai = detail!.reviews.find((r) => r.domain === "responsible-ai");
      expect(rai).toBeTruthy();
      expect(rai!.status).toBe("returned");
      expect(rai!.reviewer).toBe("Sofia Grant");
      expect(rai!.citations).toEqual(expect.arrayContaining(["MP-R-2.4", "MP-R-7"]));
    });

    it("GPU (#6): gpu_util_pct series with the 80% quota line, no eval series", async () => {
      const detail = await provider.getInitiativeDetail("claims-ocr-coder");
      const gpu = detail!.telemetry.find((t) => t.kind === "gpu_util_pct");
      expect(gpu).toBeTruthy();
      expect(gpu!.threshold).toBe(80);
      expect(detail!.telemetry.find((t) => t.kind === "eval_hallucination")).toBeUndefined();
    });

    it("events: audit trail is returned in timestamp order", async () => {
      const detail = await provider.getInitiativeDetail("member-chat-copilot");
      expect(detail!.events.length).toBeGreaterThan(5);
      const times = detail!.events.map((e) => Date.parse(e.ts));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });
  });

  describe("outcomeMetrics (seed-spec §6 targets)", () => {
    it("matches the seeded targets", async () => {
      const m = await provider.outcomeMetrics();
      // Median review cycle time ~11d (champion beats it live).
      expect(m.medianReviewCycleDays).toBe(11);
      // First-pass completeness ~60% (7 of 12 v1 intakes complete).
      expect(m.firstPassCompletenessPct).toBeGreaterThanOrEqual(55);
      expect(m.firstPassCompletenessPct).toBeLessThanOrEqual(65);
      // Drafted-vs-scratch estimate at ~4h/review.
      expect(m.reviewerHoursSaved).toBeGreaterThan(0);
      expect(m.reviewerHoursSaved % 4).toBe(0);
      // Evidence freshness 10/12 (#10 and #11 stale).
      expect(m.evidenceTotal).toBe(12);
      expect(m.evidenceFresh).toBe(10);
      // Overdue controls = 3 (#10 periodic review, #11 bias audit, #9 missing evidence).
      expect(m.overdueControls).toBe(3);
    });
  });

  describe("controlCatalog", () => {
    it("returns 17 definitions (16 domain + Q-01) with correct policy sources and statuses", async () => {
      const catalog = await provider.controlCatalog();
      expect(catalog).toHaveLength(17);

      const byId = new Map(catalog.map((c) => [c.id, c]));
      expect(byId.get("Q-01")).toMatchObject({
        domain: "runtime",
        threshold: 0.08,
        policySource: null,
      });
      expect(byId.get("H-01")).toMatchObject({ policySource: "MP-H v3 §MP-H-2" });
      expect(byId.get("R-01")!.policySource).toBe("MP-R v4 §MP-R-2");
      // Aggregated worst-instance statuses:
      expect(byId.get("D-02")!.status).toBe("overdue"); // #10
      expect(byId.get("R-01")!.status).toBe("exception_requested"); // #11
    });
  });

  describe("auditQuery — the 4 canned queries (seed-spec §7)", () => {
    it("member-facing-phi returns exactly #1, #3, #4, #9", async () => {
      const rows = await provider.auditQuery("member-facing-phi");
      expect(rows.map((r) => r.slug).sort()).toEqual(
        [
          "formulary-qa-bot",
          "member-chat-copilot",
          "prior-auth-summarizer",
          "social-sentiment-miner",
        ].sort(),
      );
      // Rows carry approver + control status detail.
      const copilot = rows.find((r) => r.slug === "member-chat-copilot")!;
      expect(copilot.approver).toBe("Angela Torres");
      expect(copilot.detail).toMatch(/controls/i);
    });

    it("approved-by-torres returns every Torres approval (fast-lane + conditional included, rejection excluded)", async () => {
      const rows = await provider.auditQuery("approved-by-torres");
      const slugs = rows.map((r) => r.slug).sort();
      expect(slugs).toEqual(
        [
          "callcenter-qa-scorer",
          "claims-ocr-coder",
          "fwa-anomaly-detector",
          "hr-resume-screener",
          "marketing-ab-tester",
          "member-chat-copilot",
          "nurse-triage-summarizer",
          "pa-correspondence-model",
        ].sort(),
      );
      expect(slugs).not.toContain("social-sentiment-miner"); // rejection is not an approval
      for (const row of rows) {
        expect(row.approver).toBe("Angela Torres");
        expect(row.eventTs).toBeTruthy();
      }
    });

    it("overdue-controls returns the 3 from §6 with remediation owners", async () => {
      const rows = await provider.auditQuery("overdue-controls");
      expect(rows.map((r) => r.slug).sort()).toEqual(
        ["formulary-qa-bot", "fwa-anomaly-detector", "hr-resume-screener"].sort(),
      );
      for (const row of rows) {
        expect(row.detail).toMatch(/remediation owner: (?!unassigned)/);
      }
      const fwa = rows.find((r) => r.slug === "fwa-anomaly-detector")!;
      expect(fwa.detail).toContain("D-02");
      const hr = rows.find((r) => r.slug === "hr-resume-screener")!;
      expect(hr.detail).toContain("R-01");
    });

    it("q01-control-changes returns Ray Chen's base-30d tightening with reason", async () => {
      const rows = await provider.auditQuery("q01-control-changes");
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.title).toBe("Q-01 Eval quality floor");
      expect(row.detail).toContain("Ray Chen");
      expect(row.detail).toContain("0.10");
      expect(row.detail).toContain("0.08");
      expect(row.detail).toContain("Q2 quality initiative");
      expect(row.eventTs).toBe("2026-06-01T00:00:00.000Z"); // base-30d
    });
  });

  /**
   * M2.5 inc.2a: optional workspace filter on listInitiatives/getInitiativeDetail.
   * Non-breaking — omitting `opts` entirely (every existing call site, incl.
   * every test above) must keep returning all 12 seeded (workspace_id NULL)
   * rows. These two extra rows are workspace-tagged directly (bypassing
   * createDraft) so they layer cleanly on top of the shared seeded fixture.
   */
  describe("workspace-scoped reads (M2.5 inc.2a foundation)", () => {
    const WS_A = "ws_test_alpha";
    const WS_B = "ws_test_beta";
    const now = new Date("2026-07-10T00:00:00.000Z");

    beforeAll(async () => {
      await db.insert(initiatives).values([
        {
          id: "init-ws-alpha",
          slug: "ws-alpha-initiative",
          title: "Workspace Alpha Draft",
          requester: "Priya Raman",
          state: "intake_draft",
          tier: null,
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: WS_A,
        },
        {
          id: "init-ws-beta",
          slug: "ws-beta-initiative",
          title: "Workspace Beta Draft",
          requester: "Dan Kowalski",
          state: "intake_draft",
          tier: null,
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: WS_B,
        },
      ]);
    });

    it("listInitiatives() with no argument returns everything unfiltered (14 rows: 12 seeded + 2 workspace-tagged)", async () => {
      const rows = await provider.listInitiatives();
      expect(rows).toHaveLength(14);
      expect(rows.map((r) => r.slug)).toEqual(
        expect.arrayContaining(["ws-alpha-initiative", "ws-beta-initiative"]),
      );
    });

    it("listInitiatives({ viewerWorkspaceId: null }) returns only the 12 null-workspace (seeded/public) rows", async () => {
      const rows = await provider.listInitiatives({ viewerWorkspaceId: null });
      expect(rows).toHaveLength(12);
      expect(rows.map((r) => r.slug)).not.toContain("ws-alpha-initiative");
      expect(rows.map((r) => r.slug)).not.toContain("ws-beta-initiative");
    });

    it("listInitiatives({ viewerWorkspaceId: WS_A }) returns the 12 null-workspace rows plus WS_A's own row (13 total)", async () => {
      const rows = await provider.listInitiatives({ viewerWorkspaceId: WS_A });
      expect(rows).toHaveLength(13);
      expect(rows.map((r) => r.slug)).toContain("ws-alpha-initiative");
      expect(rows.map((r) => r.slug)).not.toContain("ws-beta-initiative");
    });

    it("getInitiativeDetail returns the row when omitted/matching workspace, and null for a foreign workspace", async () => {
      expect(await provider.getInitiativeDetail("ws-alpha-initiative")).not.toBeNull();
      expect(
        await provider.getInitiativeDetail("ws-alpha-initiative", { viewerWorkspaceId: WS_A }),
      ).not.toBeNull();
      expect(
        await provider.getInitiativeDetail("ws-alpha-initiative", { viewerWorkspaceId: null }),
      ).toBeNull();
      expect(
        await provider.getInitiativeDetail("ws-alpha-initiative", { viewerWorkspaceId: WS_B }),
      ).toBeNull(); // foreign workspace -> treated as not found
    });
  });
});
