import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "@/lib/db/test-client";
import { controlDefinitions, deploymentVersions, incidents, initiatives } from "@/lib/db/schema";
import { loadIncidentsForViewer } from "./incident-data";

describe("loadIncidentsForViewer", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    const now = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(initiatives).values({
      id: "incident-owned-init",
      slug: "incident-owned-init",
      title: "Workspace incident fixture",
      requester: "Synthetic Requester",
      state: "deployed",
      tier: "high",
      accountableApprover: "Synthetic Approver",
      createdAt: now,
      updatedAt: now,
      workspaceId: "ws-owner",
    });
    await db.insert(controlDefinitions).values({
      id: "INCIDENT-TEST",
      domain: "runtime",
      name: "Incident test control",
      applicability: "Synthetic test only",
      owner: "Synthetic Owner",
      requiredEvidence: "Synthetic evidence",
      cadence: "continuous",
      enforcementMode: "monitor",
    });
    await db.insert(deploymentVersions).values({
      id: "incident-owned-deployment",
      initiativeId: "incident-owned-init",
      version: "v1.0",
      status: "deployed",
      deployedAt: now,
    });
    await db.insert(incidents).values({
      id: "incident-owned",
      deploymentId: "incident-owned-deployment",
      controlId: "INCIDENT-TEST",
      windowStart: now,
      identityKey: "incident-owned-deployment:INCIDENT-TEST:fixture",
      detectedAt: now,
      reviewCycleId: null,
      resolvedAt: null,
    });
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  it("reports preview incident data as unavailable without opening a database", async () => {
    const result = await loadIncidentsForViewer(null, {
      providerMode: "mock",
      hasDatabaseUrl: true,
    });

    expect(result).toEqual({ status: "unavailable", reason: "preview", incidents: null });
  });

  it("distinguishes a failed DB read from a successful empty incident list", async () => {
    const brokenDb = {
      select: () => {
        throw new Error("read failed");
      },
    };

    const result = await loadIncidentsForViewer(null, {
      providerMode: "db",
      db: brokenDb as never,
    });

    expect(result).toEqual({ status: "unavailable", reason: "load_failed", incidents: null });
  });

  it("returns a successful empty list when the query succeeds with no visible incidents", async () => {
    const result = await loadIncidentsForViewer(null, { providerMode: "db", db });

    expect(result).toEqual({ status: "success", incidents: [] });
  });

  it("returns seeded plus viewer-owned incidents while excluding foreign workspaces", async () => {
    const owner = await loadIncidentsForViewer("ws-owner", { providerMode: "db", db });
    const foreign = await loadIncidentsForViewer("ws-foreign", { providerMode: "db", db });

    expect(owner.status === "success" ? owner.incidents.map((row) => row.id) : []).toEqual([
      "incident-owned",
    ]);
    expect(foreign).toEqual({ status: "success", incidents: [] });
  });
});
