/**
 * HTTP-layer tests for app/api/exceptions/** (M4 control-exception workflow):
 * request -> decide (approve/reject) -> revoke, with session auth + SoD.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { effectiveControls } from "@/lib/db/schema";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

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

function bearer(token: string, ip = "40.40.40.1"): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

async function issueSessionFor(personaKey: string, ip = "40.40.40.1"): Promise<string> {
  const { POST } = await import("../../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  return (await res.json()).token as string;
}

async function anEffectiveControlId(): Promise<string> {
  const rows = await testDb.select().from(effectiveControls);
  return rows[0]!.id;
}

async function request(token: string, effectiveControlId: string, ip: string) {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost/api/exceptions", {
      method: "POST",
      headers: bearer(token, ip),
      body: JSON.stringify({ effectiveControlId, reason: "Vendor attestation renewal in progress." }),
    }),
  );
}

describe("POST /api/exceptions (request)", () => {
  it("401s without a session", async () => {
    const ecId = await anEffectiveControlId();
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/exceptions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "40.0.0.9" },
        body: JSON.stringify({ effectiveControlId: ecId, reason: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("200s with a session and the exception then shows in the public GET list", async () => {
    const token = await issueSessionFor("marcus-webb", "40.0.1.1");
    const ecId = await anEffectiveControlId();
    const res = await request(token, ecId, "40.0.1.1");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("requested");

    const { GET } = await import("../route");
    const listRes = await GET(new Request("http://localhost/api/exceptions"));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).exceptions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/exceptions/[id]/decide", () => {
  it("403s a non-decider (reviewer) and 200s an approver who is not the requester", async () => {
    const requesterToken = await issueSessionFor("marcus-webb", "40.0.2.1");
    const ecId = await anEffectiveControlId();
    const { id } = await (await request(requesterToken, ecId, "40.0.2.1")).json();

    const { POST: decidePost } = await import("../[id]/decide/route");

    // A reviewer cannot decide.
    const reviewerToken = await issueSessionFor("sofia-grant", "40.0.2.2");
    const forbidden = await decidePost(
      new Request(`http://localhost/api/exceptions/${id}/decide`, {
        method: "POST",
        headers: bearer(reviewerToken, "40.0.2.2"),
        body: JSON.stringify({ approve: true, reason: "no authority" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(forbidden.status).toBe(403);

    // The approver (not the requester) can.
    const approverToken = await issueSessionFor("angela-torres", "40.0.2.3");
    const ok = await decidePost(
      new Request(`http://localhost/api/exceptions/${id}/decide`, {
        method: "POST",
        headers: bearer(approverToken, "40.0.2.3"),
        body: JSON.stringify({ approve: true, reason: "Time-boxed while remediation lands." }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("approved");
  });

  it("403s the requester deciding their own exception (SoD)", async () => {
    const approverToken = await issueSessionFor("angela-torres", "40.0.3.1");
    const ecId = await anEffectiveControlId();
    const { id } = await (await request(approverToken, ecId, "40.0.3.1")).json();

    const { POST: decidePost } = await import("../[id]/decide/route");
    const res = await decidePost(
      new Request(`http://localhost/api/exceptions/${id}/decide`, {
        method: "POST",
        headers: bearer(approverToken, "40.0.3.1"),
        body: JSON.stringify({ approve: true, reason: "self-approve" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/exceptions/[id]/revoke", () => {
  it("revokes an approved exception", async () => {
    const requesterToken = await issueSessionFor("marcus-webb", "40.0.4.1");
    const ecId = await anEffectiveControlId();
    const { id } = await (await request(requesterToken, ecId, "40.0.4.1")).json();

    const { POST: decidePost } = await import("../[id]/decide/route");
    const approverToken = await issueSessionFor("angela-torres", "40.0.4.2");
    await decidePost(
      new Request(`http://localhost/api/exceptions/${id}/decide`, {
        method: "POST",
        headers: bearer(approverToken, "40.0.4.2"),
        body: JSON.stringify({ approve: true, reason: "granted" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    const { POST: revokePost } = await import("../[id]/revoke/route");
    const res = await revokePost(
      new Request(`http://localhost/api/exceptions/${id}/revoke`, {
        method: "POST",
        headers: bearer(approverToken, "40.0.4.2"),
        body: JSON.stringify({ reason: "Risk posture changed." }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("revoked");
  });
});
