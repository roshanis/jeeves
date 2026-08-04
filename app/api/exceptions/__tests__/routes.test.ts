/**
 * HTTP-layer tests for app/api/exceptions/** (M4 control-exception workflow):
 * request -> decide (approve/reject) -> revoke, with session auth + SoD.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { controlDefinitions, deploymentVersions, effectiveControls } from "@/lib/db/schema";
import { createDraft } from "@/lib/services/initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { resolveWorkspaceCookieSecret, signWorkspaceId } from "@/lib/security/workspace-cookie";

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
  // Must be a control the P2-8 eligibility gate accepts: requestException
  // rejects controls that aren't 'overdue' or 'breached' (see
  // lib/services/exception-service.ts ELIGIBLE_EXCEPTION_REQUEST_STATUSES),
  // so grabbing whatever seeded row happens to sort first is not enough.
  const rows = await testDb.select().from(effectiveControls);
  const eligible = rows.find((r) => r.status === "overdue" || r.status === "breached");
  return (eligible ?? rows[0]!).id;
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

/** Like `issueSessionFor`, but also returns the session's (randomly derived)
 * workspaceId — needed to build a workspace-tagged effective control that a
 * SPECIFIC session is authorized to mutate (external-review finding #2
 * spillover: GET /api/exceptions viewer scoping). */
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

/** A fresh effective control whose deployment/initiative chain is tagged
 * with `workspaceId` — built directly (not through the full
 * triage -> decide -> generateEffectiveControls pipeline), since only the
 * ec -> deployment -> initiative -> workspaceId chain matters for these
 * tests. Mirrors lib/services/exception-service.test.ts's identically-named
 * helper. */
async function anEffectiveControlInWorkspace(workspaceId: string): Promise<string> {
  const draft = await createDraft(testDb, {
    payload: CHAMPION_PREFILL_PAYLOAD,
    requesterActor: { id: "priya-raman", role: "requester" },
    requesterName: "Priya Raman",
    workspaceId,
  });
  const [def] = await testDb.select().from(controlDefinitions).limit(1);
  const deploymentId = `dep-test-${randomUUID()}`;
  await testDb.insert(deploymentVersions).values({
    id: deploymentId,
    initiativeId: draft.initiativeId,
    version: "v1.0",
    status: "deployed",
    modelVersion: null,
    selfHosted: false,
    feedbackProvenanceSignedOff: false,
    deployedAt: new Date(),
    pausedAt: null,
    retiredAt: null,
  });
  const ecId = `ec-test-${randomUUID()}`;
  await testDb.insert(effectiveControls).values({
    id: ecId,
    deploymentId,
    controlId: def!.id,
    version: 1,
    status: "overdue",
    thresholdOverride: null,
    evidence: null,
    evidenceAt: null,
    dueAt: null,
    remediationOwner: null,
    createdAt: new Date(),
  });
  return ecId;
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

/* ---------------------------------------------------------------------------
 * GET /api/exceptions workspace scoping (external-review finding #2
 * spillover, assigned to this task via ownership of this route): the viewer
 * is the caller's valid session workspaceId, else a verified signed
 * `jeeves_workspace` cookie, else null (seeded-only). An exception is
 * visible when its `initiativeId` is null, OR the owning initiative's
 * `workspaceId` is null, OR it equals the viewer's.
 * ------------------------------------------------------------------------ */
describe("GET /api/exceptions (workspace scoping)", () => {
  async function listAs(headers: HeadersInit): Promise<{ status: number; reasons: string[] }> {
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/exceptions", { headers }));
    const json = await res.json();
    return { status: res.status, reasons: json.exceptions.map((e: { reason: string }) => e.reason) };
  }

  it("an anonymous (no session, no cookie) viewer sees only seeded (null-workspace) exceptions", async () => {
    const wsA = await issueSessionWithWorkspace("marcus-webb", "40.1.0.1");
    const ecA = await anEffectiveControlInWorkspace(wsA.workspaceId);
    await request(wsA.token, ecA, "40.1.0.1");

    const { reasons } = await listAs({});
    expect(reasons).not.toContain("Vendor attestation renewal in progress.");
    // The seeded exception (null-workspace) is always visible.
    expect(reasons.length).toBeGreaterThanOrEqual(1);
  });

  it("ws-B's session cannot see ws-A's live-created exception", async () => {
    const wsA = await issueSessionWithWorkspace("marcus-webb", "40.1.1.1");
    const ecA = await anEffectiveControlInWorkspace(wsA.workspaceId);
    await request(wsA.token, ecA, "40.1.1.1");

    const wsB = await issueSessionWithWorkspace("sofia-grant", "40.1.1.2");
    const { reasons } = await listAs(bearer(wsB.token, "40.1.1.2"));
    expect(reasons).not.toContain("Vendor attestation renewal in progress.");
  });

  it("ws-A's own session can see its live-created exception", async () => {
    const wsA = await issueSessionWithWorkspace("marcus-webb", "40.1.2.1");
    const ecA = await anEffectiveControlInWorkspace(wsA.workspaceId);
    await request(wsA.token, ecA, "40.1.2.1");

    const { reasons } = await listAs(bearer(wsA.token, "40.1.2.1"));
    expect(reasons).toContain("Vendor attestation renewal in progress.");
  });

  it("falls back to a verified signed jeeves_workspace cookie when there is no Bearer session", async () => {
    const wsA = await issueSessionWithWorkspace("marcus-webb", "40.1.3.1");
    const ecA = await anEffectiveControlInWorkspace(wsA.workspaceId);
    await request(wsA.token, ecA, "40.1.3.1");

    const secret = resolveWorkspaceCookieSecret();
    expect(secret).not.toBeNull();
    const signedCookie = signWorkspaceId(wsA.workspaceId, secret!);
    const { reasons } = await listAs({ cookie: `jeeves_workspace=${encodeURIComponent(signedCookie)}` });
    expect(reasons).toContain("Vendor attestation renewal in progress.");
  });

  it("an unsigned/tampered jeeves_workspace cookie is treated as absent (seeded-only), not trusted", async () => {
    const wsA = await issueSessionWithWorkspace("marcus-webb", "40.1.4.1");
    const ecA = await anEffectiveControlInWorkspace(wsA.workspaceId);
    await request(wsA.token, ecA, "40.1.4.1");

    const { reasons } = await listAs({ cookie: `jeeves_workspace=${encodeURIComponent(wsA.workspaceId)}` });
    expect(reasons).not.toContain("Vendor attestation renewal in progress.");
  });
});
