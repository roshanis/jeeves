/**
 * HTTP-layer tests for app/api/deployments/** : GET /api/deployments/promotions
 * (public list of checkpoints awaiting feedback-provenance sign-off) and
 * POST /api/deployments/promotions/[id]/promote (approver-only promotion
 * action). Mirrors app/api/admin/__tests__/routes.test.ts's conventions —
 * createTestDb/closeTestDb/seedDatabase, vi.mock("@/lib/db/client"),
 * resetGuardStateForTests(), a real session issued via POST /api/session.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { deploymentVersions, initiatives } from "@/lib/db/schema";
import { createDraft } from "@/lib/services/initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  testDb = await createTestDb();
  await seedDatabase(testDb);
  resetGuardStateForTests();
});

afterEach(async () => {
  await closeTestDb(testDb);
});

function bearer(token: string, ip: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

async function issueSessionFor(personaKey: string, ip: string): Promise<string> {
  const { POST } = await import("../../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { token: string };
  return json.token;
}

/** Like `issueSessionFor`, but also returns the session's (randomly derived)
 * workspaceId — needed to build a workspace-tagged initiative that a
 * SPECIFIC session is authorized to mutate. Mirrors
 * app/api/exceptions/__tests__/routes.test.ts's identically-named helper. */
async function issueSessionWithWorkspace(
  personaKey: string,
  ip: string,
): Promise<{ token: string; workspaceId: string }> {
  const { POST } = await import("../../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  const json = await res.json();
  return { token: json.token as string, workspaceId: json.workspaceId as string };
}

/** A fresh initiative + two deployment_versions rows (one deployed, one
 * awaiting_promotion_signoff), tagged with `workspaceId`. Mirrors
 * lib/services/promotion-service.test.ts's identically-named helper. */
async function initiativeWithPromotableCheckpointInWorkspace(
  workspaceId: string,
): Promise<{ initiativeId: string; awaitingId: string }> {
  const draft = await createDraft(testDb, {
    payload: CHAMPION_PREFILL_PAYLOAD,
    requesterActor: { id: "priya-raman", role: "requester" },
    requesterName: "Priya Raman",
    workspaceId,
  });
  const awaitingId = `dep-awaiting-${randomUUID()}`;
  await testDb.insert(deploymentVersions).values({
    id: `dep-current-${randomUUID()}`,
    initiativeId: draft.initiativeId,
    version: "v1.0",
    status: "deployed",
    modelVersion: null,
    selfHosted: false,
    feedbackProvenanceSignedOff: false,
    deployedAt: new Date(Date.now() - 100_000),
    pausedAt: null,
    retiredAt: null,
  });
  await testDb.insert(deploymentVersions).values({
    id: awaitingId,
    initiativeId: draft.initiativeId,
    version: "v1.1",
    status: "awaiting_promotion_signoff",
    modelVersion: null,
    selfHosted: false,
    feedbackProvenanceSignedOff: false,
    deployedAt: new Date(),
    pausedAt: null,
    retiredAt: null,
  });
  return { initiativeId: draft.initiativeId, awaitingId };
}

async function v21DeploymentId(): Promise<string> {
  const [init] = await testDb.select().from(initiatives).where(eq(initiatives.slug, "pa-correspondence-model"));
  const rows = await testDb.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, init!.id));
  return rows.find((d) => d.version === "v2.1")!.id;
}

const FULL_ATTESTATION = {
  feedbackDataSource: "Member correspondence feedback pipeline, Q2 2026 batch.",
  consentBasis: "Covered under standing member-services consent.",
  reviewedBy: "Angela Torres",
};

describe("GET /api/deployments/promotions", () => {
  it("200s with no session required and includes the seeded v2.1 entry", async () => {
    const { GET } = await import("../promotions/route");
    // Bare request, no cookie/auth → resolves to the public (null) viewer.
    const res = await GET(new Request("http://localhost/api/deployments/promotions"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ version: string; initiativeSlug: string }>;
    const entry = json.find((p) => p.version === "v2.1" && p.initiativeSlug === "pa-correspondence-model");
    expect(entry).toBeTruthy();
  });
});

describe("POST /api/deployments/promotions/[id]/promote", () => {
  it("401s an unauthenticated request", async () => {
    const deploymentVersionId = await v21DeploymentId();
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "40.0.0.1" },
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "x" }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect(res.status).toBe(401);
  });

  it("403s a non-approver session (admin persona)", async () => {
    const token = await issueSessionFor("ray-chen", "40.0.0.2");
    const deploymentVersionId = await v21DeploymentId();
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.2"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect(res.status).toBe(403);
  });

  it("403s a non-approver session (reviewer persona)", async () => {
    const token = await issueSessionFor("elena-vasquez", "40.0.0.3");
    const deploymentVersionId = await v21DeploymentId();
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.3"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect(res.status).toBe(403);
  });

  it("400s a missing attestation field for an authenticated approver", async () => {
    const token = await issueSessionFor("angela-torres", "40.0.0.4");
    const deploymentVersionId = await v21DeploymentId();
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.4"),
        body: JSON.stringify({
          attestation: { ...FULL_ATTESTATION, consentBasis: "" },
          reason: "reason present",
        }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect(res.status).toBe(400);
  });

  it("200s the happy path for the approver persona, and a second call on the same id is rejected", async () => {
    const token = await issueSessionFor("angela-torres", "40.0.0.5");
    const deploymentVersionId = await v21DeploymentId();
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.5"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "Feedback-provenance reviewed." }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("deployed");
    expect(json.promotedVersion).toBe("v2.1");

    const [dep] = await testDb.select().from(deploymentVersions).where(eq(deploymentVersions.id, deploymentVersionId));
    expect(dep!.status).toBe("deployed");

    const res2 = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.5"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "Second attempt." }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );
    expect([400, 409]).toContain(res2.status);
  });

  /* ---------------------------------------------------------------------
   * P1 fix — workspace authorization: promoteCheckpoint now receives the
   * session workspace and rejects a cross-workspace promote with the same
   * 404 shape as an unknown checkpoint id.
   * -------------------------------------------------------------------- */
  it("404s a promote of a checkpoint owned by a different workspace", async () => {
    const owner = await issueSessionWithWorkspace("angela-torres", "40.0.0.6");
    const { awaitingId } = await initiativeWithPromotableCheckpointInWorkspace(owner.workspaceId);

    const intruder = await issueSessionWithWorkspace("angela-torres", "40.0.0.7");
    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${awaitingId}/promote`, {
        method: "POST",
        headers: bearer(intruder.token, "40.0.0.7"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: awaitingId }) },
    );
    expect(res.status).toBe(404);
  });

  /* ---------------------------------------------------------------------
   * P1 fix — concurrency: the retire/promote updates are now
   * compare-and-set (CAS); a lost-update race throws ConflictError, which
   * this route maps to 409. True overlapping transactions aren't
   * reproducible against PGlite (see
   * lib/services/promotion-service.test.ts's identical rationale comment),
   * so this test simulates the race deterministically by injecting a
   * same-transaction write between the service's own read and its CAS
   * update.
   * -------------------------------------------------------------------- */
  it("409s when the current-deployed row changes concurrently underneath the promote (ConflictError -> 409)", async () => {
    const token = await issueSessionFor("angela-torres", "40.0.0.8");
    const deploymentVersionId = await v21DeploymentId();
    const [init] = await testDb.select().from(initiatives).where(eq(initiatives.slug, "pa-correspondence-model"));
    const rows = await testDb.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, init!.id));
    const v20Id = rows.find((d) => d.version === "v2.0")!.id;

    // Test-only same-transaction write injection — `any`-typed by design
    // (the mock surface is a live Drizzle transaction-scoped query builder
    // chain, not meaningfully typeable).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const dbAny = testDb as any;
    const realTransaction = dbAny.transaction.bind(dbAny);
    const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
      realTransaction(async (tx: any) => {
        const realUpdate = tx.update.bind(tx);
        vi.spyOn(tx, "update").mockImplementation((table: any) => {
          const builder = realUpdate(table);
          if (table === deploymentVersions) {
            const realSet = builder.set.bind(builder);
            builder.set = (values: Record<string, unknown>) => {
              const base = realSet(values);
              if (values.status === "retired") {
                const realWhere = base.where.bind(base);
                base.where = (cond: unknown) => {
                  const afterWhere = realWhere(cond);
                  const realReturning = afterWhere.returning.bind(afterWhere);
                  afterWhere.returning = async (...args: unknown[]) => {
                    // Simulated concurrent writer: flips the current-deployed
                    // row's status directly, inside the SAME transaction,
                    // between the service's own read and its CAS update.
                    await realUpdate(deploymentVersions)
                      .set({ status: "paused" })
                      .where(eq(deploymentVersions.id, v20Id));
                    return realReturning(...args);
                  };
                  return afterWhere;
                };
              }
              return base;
            };
          }
          return builder;
        });
        return cb(tx);
      }),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const { POST } = await import("../promotions/[id]/promote/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/promotions/${deploymentVersionId}/promote`, {
        method: "POST",
        headers: bearer(token, "40.0.0.8"),
        body: JSON.stringify({ attestation: FULL_ATTESTATION, reason: "Feedback-provenance reviewed." }),
      }),
      { params: Promise.resolve({ id: deploymentVersionId }) },
    );

    spy.mockRestore();

    expect(res.status).toBe(409);
  });
});

/**
 * POST /api/deployments/[id]/rollback tests. The seeded pa-correspondence-model
 * initiative has only v2.0 (deployed) + v2.1 (awaiting-signoff) — no prior
 * retired/paused version — so each test seeds a synthetic prior "v1.9"
 * (retired) row directly, mirroring promotion-service.test.ts's approach.
 * (See report: a seeded multi-version rollback scenario is a follow-up.)
 */
describe("POST /api/deployments/[id]/rollback", () => {
  async function paCorrespondenceModelId(): Promise<string> {
    const [init] = await testDb.select().from(initiatives).where(eq(initiatives.slug, "pa-correspondence-model"));
    return init!.id;
  }

  // pa-correspondence-model is seeded with a genuine prior retired v1.9 as a
  // rollback target — use it directly rather than synthesizing a duplicate.
  async function seedPriorRetiredVersion(initiativeId: string): Promise<string> {
    const rows = await testDb
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.initiativeId, initiativeId));
    const v19 = rows.find((d) => d.version === "v1.9" && d.status === "retired")!;
    return v19.id;
  }

  it("401s an unauthenticated request", async () => {
    const initiativeId = await paCorrespondenceModelId();
    const priorId = await seedPriorRetiredVersion(initiativeId);
    const { POST } = await import("../[id]/rollback/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/${initiativeId}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "41.0.0.1" },
        body: JSON.stringify({ targetDeploymentVersionId: priorId, reason: "rollback" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(401);
  });

  it("200s the happy path for an approver session", async () => {
    const initiativeId = await paCorrespondenceModelId();
    const priorId = await seedPriorRetiredVersion(initiativeId);
    const token = await issueSessionFor("angela-torres", "41.0.0.2");
    const { POST } = await import("../[id]/rollback/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/${initiativeId}/rollback`, {
        method: "POST",
        headers: bearer(token, "41.0.0.2"),
        body: JSON.stringify({
          targetDeploymentVersionId: priorId,
          reason: "Regression found in v2.0; rolling back to v1.9.",
        }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("deployed");
    expect(json.toVersion).toBe("v1.9");
    expect(json.fromVersion).toBe("v2.0");

    const rows = await testDb.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
    const v19 = rows.find((d) => d.version === "v1.9")!;
    const v20 = rows.find((d) => d.version === "v2.0")!;
    expect(v19.status).toBe("deployed");
    expect(v20.status).toBe("retired");
  });

  it("403s a non-approver, non-admin session (reviewer persona)", async () => {
    const initiativeId = await paCorrespondenceModelId();
    const priorId = await seedPriorRetiredVersion(initiativeId);
    const token = await issueSessionFor("elena-vasquez", "41.0.0.3");
    const { POST } = await import("../[id]/rollback/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/${initiativeId}/rollback`, {
        method: "POST",
        headers: bearer(token, "41.0.0.3"),
        body: JSON.stringify({ targetDeploymentVersionId: priorId, reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(403);
  });

  it("400s a missing/empty reason for an authenticated approver", async () => {
    const initiativeId = await paCorrespondenceModelId();
    const priorId = await seedPriorRetiredVersion(initiativeId);
    const token = await issueSessionFor("angela-torres", "41.0.0.4");
    const { POST } = await import("../[id]/rollback/route");
    const res = await POST(
      new Request(`http://localhost/api/deployments/${initiativeId}/rollback`, {
        method: "POST",
        headers: bearer(token, "41.0.0.4"),
        body: JSON.stringify({ targetDeploymentVersionId: priorId, reason: "" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(400);
  });

  it("404s an unknown initiative id", async () => {
    const token = await issueSessionFor("angela-torres", "41.0.0.5");
    const { POST } = await import("../[id]/rollback/route");
    const res = await POST(
      new Request("http://localhost/api/deployments/init-does-not-exist/rollback", {
        method: "POST",
        headers: bearer(token, "41.0.0.5"),
        body: JSON.stringify({ targetDeploymentVersionId: "dep-does-not-exist", reason: "reason" }),
      }),
      { params: Promise.resolve({ id: "init-does-not-exist" }) },
    );
    expect(res.status).toBe(404);
  });
});
