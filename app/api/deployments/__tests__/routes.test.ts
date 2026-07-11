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
