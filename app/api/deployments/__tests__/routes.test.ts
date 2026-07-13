/**
 * HTTP-layer tests for app/api/deployments/** : GET /api/deployments/promotions
 * (public list of checkpoints awaiting feedback-provenance sign-off) and
 * POST /api/deployments/promotions/[id]/promote (approver-only promotion
 * action). Mirrors app/api/admin/__tests__/routes.test.ts's conventions —
 * createTestDb/closeTestDb/seedDatabase, vi.mock("@/lib/db/client"),
 * resetGuardStateForTests(), a real session issued via POST /api/session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { deploymentVersions, initiatives } from "@/lib/db/schema";

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
    const res = await GET();
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

  async function seedPriorRetiredVersion(initiativeId: string): Promise<string> {
    const id = `dep-test-${randomUUID()}`;
    await testDb.insert(deploymentVersions).values({
      id,
      initiativeId,
      version: "v1.9",
      status: "retired",
      modelVersion: "meridian-correspondence-1.9",
      selfHosted: false,
      feedbackProvenanceSignedOff: true,
      deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      retiredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
    });
    return id;
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
