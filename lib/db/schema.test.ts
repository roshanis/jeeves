import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "./test-client";
import {
  auditEvents,
  deploymentVersions,
  incidents,
  initiatives,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
  runBudget,
  intakeVersions,
  controlDefinitions,
} from "./schema";

/**
 * Schema/migration-level tests (plan §5, §8 test 11):
 *  - migrations run cleanly on a fresh PGlite instance
 *  - the registry is a SQL view, not a table
 *  - uniqueness constraints from plan §5 are enforced
 *  - audit_events is append-only AT THE DB LEVEL (trigger rejects UPDATE/DELETE)
 */
describe("lib/db/schema — migrations and constraints", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("runs all migrations and creates every plan §5 table", async () => {
    const tables = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    const names = tables.rows.map((r) => (r as { table_name: string }).table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "initiatives",
        "intake_versions",
        "risk_assessments",
        "review_cycles",
        "review_decisions",
        "deployment_versions",
        "control_definitions",
        "effective_controls",
        "observations",
        "incidents",
        "audit_events",
        "run_budget",
      ]),
    );
  });

  it("defines the initiative registry as a SQL VIEW, not a table", async () => {
    const views = await db.execute(sql`
      select table_name from information_schema.views where table_schema = 'public'
    `);
    const names = views.rows.map((r) => (r as { table_name: string }).table_name);
    expect(names).toContain("initiative_registry");

    const tables = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const tableNames = tables.rows.map((r) => (r as { table_name: string }).table_name);
    expect(tableNames).not.toContain("initiative_registry");
  });

  it("rejects a second review_decision for the same (cycle, domain)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    await db.insert(initiatives).values({
      id: "init-1",
      slug: "test-initiative",
      title: "Test",
      requester: "Priya Raman",
      state: "in_review",
      tier: "high",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(intakeVersions).values({
      id: "intake-1",
      initiativeId: "init-1",
      version: 1,
      submitted: true,
      fields: {},
      createdAt: now,
    });
    await db.insert(riskAssessments).values({
      id: "ra-1",
      initiativeId: "init-1",
      version: 1,
      intakeVersionId: "intake-1",
      tier: "high",
      flags: {},
      requiredDomains: ["legal"],
      createdAt: now,
    });
    await db.insert(reviewCycles).values({
      id: "cycle-1",
      initiativeId: "init-1",
      kind: "initial",
      riskAssessmentId: "ra-1",
      openedAt: now,
    });
    await db.insert(reviewDecisions).values({
      id: "rd-1",
      cycleId: "cycle-1",
      domain: "legal",
      status: "signed",
      reviewer: "James Liu",
      citations: [],
      createdAt: now,
    });

    await expect(
      db.insert(reviewDecisions).values({
        id: "rd-2",
        cycleId: "cycle-1",
        domain: "legal",
        status: "pending",
        citations: [],
        createdAt: now,
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate incident identity for (deployment, control, windowStart)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    await db.insert(initiatives).values({
      id: "init-2",
      slug: "test-initiative-2",
      title: "Test 2",
      requester: "Priya Raman",
      state: "deployed",
      tier: "high",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(deploymentVersions).values({
      id: "dep-1",
      initiativeId: "init-2",
      version: "v1.0",
      status: "deployed",
      deployedAt: now,
    });
    await db.insert(controlDefinitions).values({
      id: "Q-01",
      domain: "runtime",
      name: "Eval quality floor",
      applicability: "all deployments",
      owner: "Ray Chen",
      requiredEvidence: "n/a",
      cadence: "continuous",
      enforcementMode: "block",
      observationKind: "eval_hallucination",
      tierDefaultThresholds: { high: 0.08, critical: 0.05 },
      sustainedWindow: 3,
    });
    const windowStart = new Date("2026-07-10T00:00:00Z");

    await db.insert(incidents).values({
      id: "inc-1",
      deploymentId: "dep-1",
      controlId: "Q-01",
      windowStart,
      identityKey: "dep-1:Q-01:1752105600000",
      detectedAt: now,
    });

    await expect(
      db.insert(incidents).values({
        id: "inc-2",
        deploymentId: "dep-1",
        controlId: "Q-01",
        windowStart,
        identityKey: "dep-1:Q-01:1752105600000-dup",
        detectedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("rejects a second run_budget row for the same day", async () => {
    await db.insert(runBudget).values({ id: "b1", day: "2026-07-01", tokensCap: 100000 });
    await expect(
      db.insert(runBudget).values({ id: "b2", day: "2026-07-01", tokensCap: 999 }),
    ).rejects.toThrow();
  });

  it("rejects UPDATE on audit_events (DB-level append-only)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    await db.insert(auditEvents).values({
      id: "ae-1",
      ts: now,
      actor: "system",
      actorRole: "system",
      action: "test",
      detail: "test detail",
    });

    // Drizzle wraps the underlying Postgres error; the trigger's RAISE
    // EXCEPTION message (plan §8 test 11) is the driver error's `cause`.
    await expect(
      db.execute(sql`update audit_events set detail = 'changed' where id = 'ae-1'`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/i) },
    });
  });

  it("rejects DELETE on audit_events (DB-level append-only)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    await db.insert(auditEvents).values({
      id: "ae-2",
      ts: now,
      actor: "system",
      actorRole: "system",
      action: "test",
      detail: "test detail",
    });

    await expect(
      db.execute(sql`delete from audit_events where id = 'ae-2'`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/i) },
    });
  });

  it("still allows INSERT on audit_events (append-only means no UPDATE/DELETE, not read-only)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    await expect(
      db.insert(auditEvents).values({
        id: "ae-3",
        ts: now,
        actor: "system",
        actorRole: "system",
        action: "test",
        detail: "insert should still work",
      }),
    ).resolves.not.toThrow();
  });
});
