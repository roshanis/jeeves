// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { deploymentVersions, effectiveControls, initiatives } from "../db/schema";
import { DbDataProvider } from "./db-provider";

describe("current state projections", () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); await seedDatabase(db); });
  afterAll(async () => { await closeTestDb(db); });

  it("uses current control revisions and operational deployment while retaining history", async () => {
    const [initiative] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
    const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiative.id));
    const deployed = rows.find((row) => row.status === "deployed")!;
    const candidate = { ...deployed, id: "new-pending-candidate", version: "v-next", status: "awaiting_promotion_signoff", deployedAt: new Date(deployed.deployedAt.getTime() + 1000) };
    await db.insert(deploymentVersions).values(candidate);
    const [old] = await db.select().from(effectiveControls)
      .where(and(eq(effectiveControls.deploymentId, deployed.id), eq(effectiveControls.controlId, "Q-01")));
    await db.update(effectiveControls).set({ status: "breached", thresholdOverride: 0.01 }).where(eq(effectiveControls.id, old.id));
    await db.insert(effectiveControls).values({ ...old, id: "current-q01", version: old.version + 1, status: "met", thresholdOverride: 0.5 });
    await db.insert(effectiveControls).values({ ...old, id: "candidate-q01", deploymentId: candidate.id, status: "overdue", thresholdOverride: 0.001 });
    const provider = new DbDataProvider(db);
    const detail = (await provider.getInitiativeDetail(initiative.slug))!;
    expect(detail.controls.filter((row) => row.id === "Q-01")).toHaveLength(1);
    expect(detail.controls.find((row) => row.id === "Q-01")).toMatchObject({ status: "met", threshold: 0.5 });
    expect(detail.telemetry.find((row) => row.kind === "eval_hallucination")?.threshold).toBe(0.5);
    expect(detail.summary.overdue).toBe(false);
    expect((await provider.controlCatalog()).find((row) => row.id === "Q-01")?.status).toBe("met");
    expect(detail.deployments).toHaveLength(rows.length + 1);
    expect(await db.select().from(effectiveControls).where(eq(effectiveControls.deploymentId, deployed.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: old.id, status: "breached" })]));
  });
  it("keeps retired control history readable without counting it as current overdue work", async () => {
    const provider = new DbDataProvider(db);
    const before = await provider.outcomeMetrics();
    const [initiative] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
    const deployments = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiative.id));
    for (const deployment of deployments) {
      await db.update(deploymentVersions).set({ status: "retired" }).where(eq(deploymentVersions.id, deployment.id));
      await db.update(effectiveControls).set({ status: "overdue" }).where(eq(effectiveControls.deploymentId, deployment.id));
    }
    await db.update(initiatives).set({ state: "retired" }).where(eq(initiatives.id, initiative.id));
    const detail = (await provider.getInitiativeDetail(initiative.slug))!;
    expect(detail.controls.length).toBeGreaterThan(0);
    expect(detail.summary.overdue).toBe(false);
    const after = await provider.outcomeMetrics();
    expect(after.overdueControls).toBe(before.overdueControls);
    expect(after.evidenceFresh).toBe(before.evidenceFresh);
    expect((await provider.auditQuery("overdue-controls")).some((row) => row.slug === initiative.slug)).toBe(false);
  });

});
