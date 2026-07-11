import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../lib/db/test-client";
import { seedDatabase, INITIATIVE_SEEDS, BASE_DATE_MS } from "./seed";
import { deriveTier } from "../lib/triage/rules";
import { evaluateControl } from "../lib/controls/evaluate";
import {
  auditEvents,
  deploymentVersions,
  initiatives,
  intakeVersions,
  observations,
} from "../lib/db/schema";
import { eq } from "drizzle-orm";

describe("scripts/seed.ts", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("seeds all 12 initiatives with tiers matching deriveTier(flags) (seed-spec §2 golden fixture)", async () => {
    await seedDatabase(db);
    for (const seed of INITIATIVE_SEEDS) {
      expect(deriveTier(seed.flags)).toBe(seed.expectedTier);
    }
    const rows = await db.select().from(initiatives);
    expect(rows).toHaveLength(12);
    for (const seed of INITIATIVE_SEEDS) {
      const row = rows.find((r) => r.slug === seed.slug);
      expect(row, `missing initiative row for ${seed.slug}`).toBeTruthy();
      expect(row!.tier).toBe(seed.expectedTier);
    }
  });

  it("seeds champion (#1 prior-auth-summarizer) as intake_draft only, unsubmitted, missing data.retentionIntent", async () => {
    await seedDatabase(db);
    const [init] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "prior-auth-summarizer"));
    expect(init).toBeTruthy();
    expect(init!.state).toBe("intake_draft");

    const [intake] = await db
      .select()
      .from(intakeVersions)
      .where(eq(intakeVersions.initiativeId, init!.id));
    expect(intake).toBeTruthy();
    expect(intake!.submitted).toBe(false);
    expect(intake!.missing).toContain("data.retentionIntent");
    expect(Object.prototype.hasOwnProperty.call(intake!.fields, "data.retentionIntent")).toBe(
      false,
    );
  });

  it("is deterministic and idempotent: two seed runs produce identical row sets (incl. PRNG-generated observations)", async () => {
    const countsA = await seedDatabase(db);
    const initiativesA = await db.select().from(initiatives).orderBy(initiatives.slug);
    const auditA = await db.select().from(auditEvents).orderBy(auditEvents.id);
    const obsA = await db.select().from(observations).orderBy(observations.id);

    const countsB = await seedDatabase(db);
    const initiativesB = await db.select().from(initiatives).orderBy(initiatives.slug);
    const auditB = await db.select().from(auditEvents).orderBy(auditEvents.id);
    const obsB = await db.select().from(observations).orderBy(observations.id);

    expect(countsB).toEqual(countsA);
    // Full deep-equality including deterministic ids: nextId counters reset
    // per run and PRNG streams are keyed off the fixed seed, so every
    // column of every row must be byte-identical across runs.
    expect(initiativesB).toEqual(initiativesA);
    expect(auditB).toEqual(auditA);
    expect(obsB).toEqual(obsA);
  });

  it("produces ~120-150 audit events reconstructing every seeded state (seed-spec §5)", async () => {
    const counts = await seedDatabase(db);
    expect(counts.auditEvents).toBeGreaterThanOrEqual(120);
    expect(counts.auditEvents).toBeLessThanOrEqual(150);
  });

  it("records Ray Chen's Q-01 threshold tightening 0.10 -> 0.08 at base-30d", async () => {
    await seedDatabase(db);
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "control_threshold_changed"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actor).toBe("Ray Chen");
    expect(row.before).toBe("0.10");
    expect(row.after).toBe("0.08");
    expect(row.ts.getTime()).toBe(BASE_DATE_MS - 30 * 24 * 60 * 60 * 1000);
  });

  it("#4 member-chat-copilot is deployed at seed time with a forward-seeded breach series provable by evaluateControl()", async () => {
    await seedDatabase(db);
    const [init] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    // Seed-spec §2 row 4: deployed v1.2 at seed time — the breach -> pause
    // -> reassessment is the LIVE demo, so no paused state is pre-seeded.
    expect(init!.state).toBe("deployed");

    const [dep] = await db
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.initiativeId, init!.id));
    expect(dep).toBeTruthy();
    expect(dep!.status).toBe("deployed");
    expect(dep!.version).toBe("v1.2");

    const obsRows = await db
      .select()
      .from(observations)
      .where(eq(observations.deploymentId, dep!.id));
    const hallucinationObs = obsRows
      .filter((o) => o.kind === "eval_hallucination")
      .map((o) => ({ ts: o.ts.getTime(), value: o.value }));

    expect(hallucinationObs).toHaveLength(30);

    const control = {
      deploymentId: dep!.id,
      controlId: "Q-01",
      threshold: 0.08,
      sustainedWindow: 3,
    };

    // At the base date the series is still healthy — no sustained crossing
    // has happened yet (the initiative is honestly 'deployed').
    const atBase = evaluateControl(control, hallucinationObs, BASE_DATE_MS);
    expect(atBase.breached).toBe(false);

    // Replaying through base+14d MUST find >=3 consecutive points strictly
    // above 0.08 (task brief / seed-spec §4 guarantee, breach fires live).
    const atEnd = evaluateControl(
      control,
      hallucinationObs,
      BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000,
    );
    expect(atEnd.breached).toBe(true);
    expect(atEnd.windowStartTs).not.toBeNull();
    expect(atEnd.windowStartTs!).toBeGreaterThan(BASE_DATE_MS);
    expect(atEnd.windowStartTs!).toBeLessThanOrEqual(BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000);
    expect(atEnd.breachingObservations).toHaveLength(3);
    for (const o of atEnd.breachingObservations) {
      expect(o.value).toBeGreaterThan(0.08);
    }
  });

  it("#7 provider-dedup-agent requires exactly 5 domains with exactly 3 signed", async () => {
    await seedDatabase(db);
    const { reviewCycles, reviewDecisions, riskAssessments } = await import("../lib/db/schema");
    const [init] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "provider-dedup-agent"));
    const [ra] = await db
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.initiativeId, init!.id));
    expect(ra!.requiredDomains).toHaveLength(5);

    const [cycle] = await db
      .select()
      .from(reviewCycles)
      .where(eq(reviewCycles.initiativeId, init!.id));
    const decisions = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.cycleId, cycle!.id));
    expect(decisions).toHaveLength(5);
    expect(decisions.filter((d) => d.status === "signed")).toHaveLength(3);
    expect(decisions.filter((d) => d.status === "pending")).toHaveLength(2);
  });
});
