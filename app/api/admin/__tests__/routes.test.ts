/**
 * HTTP-layer tests for app/api/admin/** (task brief deliverable 3 + 4): the
 * two live admin actions over HTTP — POST /api/admin/threshold and POST
 * /api/admin/deployments/[id]/pause|resume. Admin-only + non-empty reason;
 * non-admin personas get 403. Mirrors app/api/__tests__/routes.test.ts's
 * guard-order conventions (401 -> 429 -> 400 -> 403).
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

async function memberChatCopilotId(): Promise<string> {
  const [init] = await testDb.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
  return init!.id;
}

describe("POST /api/admin/threshold", () => {
  it("401s an unauthenticated request", async () => {
    const { POST } = await import("../threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "30.0.0.1" },
        body: JSON.stringify({ controlId: "Q-01", value: 0.06, reason: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400s a malformed body (missing reason) for an authenticated admin", async () => {
    const token = await issueSessionFor("ray-chen", "30.0.0.2");
    const { POST } = await import("../threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: bearer(token, "30.0.0.2"),
        body: JSON.stringify({ controlId: "Q-01", value: 0.06 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("403s a non-admin persona (requester)", async () => {
    const token = await issueSessionFor("priya-raman", "30.0.0.3");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: bearer(token, "30.0.0.3"),
        body: JSON.stringify({ controlId: "Q-01", initiativeId, value: 0.06, reason: "not admin" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s the approver persona too (not just requester) — admin-only, no exceptions", async () => {
    const token = await issueSessionFor("angela-torres", "30.0.0.4");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: bearer(token, "30.0.0.4"),
        body: JSON.stringify({ controlId: "Q-01", initiativeId, value: 0.06, reason: "not admin" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("200s for the admin persona and writes a project override + audit event", async () => {
    const token = await issueSessionFor("ray-chen", "30.0.0.5");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: bearer(token, "30.0.0.5"),
        body: JSON.stringify({
          controlId: "Q-01",
          initiativeId,
          value: 0.06,
          reason: "Post-breach tightening, high member visibility.",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scope).toBe("project-override");
    expect(json.after).toBe(0.06);
  });

  it("429s after a rate-limit burst from the same admin client", async () => {
    const token = await issueSessionFor("ray-chen", "30.0.0.6");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../threshold/route");
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) {
      last = await POST(
        new Request("http://localhost/api/admin/threshold", {
          method: "POST",
          headers: bearer(token, "30.0.0.6"),
          body: JSON.stringify({ controlId: "Q-01", initiativeId, value: 0.06, reason: "burst" }),
        }),
      );
    }
    expect(last!.status).toBe(429);
  });
});

describe("POST /api/admin/deployments/[id]/pause", () => {
  it("401s an unauthenticated request", async () => {
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../deployments/[id]/pause/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "31.0.0.1" },
        body: JSON.stringify({ reason: "x" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(401);
  });

  it("403s a non-admin persona", async () => {
    const token = await issueSessionFor("elena-vasquez", "31.0.0.2");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../deployments/[id]/pause/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(token, "31.0.0.2"),
        body: JSON.stringify({ reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(403);
  });

  it("400s an empty reason for an authenticated admin (typed ValidationError)", async () => {
    const token = await issueSessionFor("ray-chen", "31.0.0.3");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../deployments/[id]/pause/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(token, "31.0.0.3"),
        body: JSON.stringify({ reason: "" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(400);
  });

  it("200s for the admin persona with a reason and pauses the deployment", async () => {
    const token = await issueSessionFor("ray-chen", "31.0.0.4");
    const initiativeId = await memberChatCopilotId();
    const { POST } = await import("../deployments/[id]/pause/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(token, "31.0.0.4"),
        body: JSON.stringify({ reason: "Manual pause for maintenance." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.after).toBe("paused");

    const [init] = await testDb.select().from(initiatives).where(eq(initiatives.id, initiativeId));
    expect(init!.state).toBe("paused");
  });
});

describe("POST /api/admin/deployments/[id]/resume", () => {
  it("403s a non-admin persona", async () => {
    const adminToken = await issueSessionFor("ray-chen", "32.0.0.1");
    const initiativeId = await memberChatCopilotId();
    const { POST: pausePost } = await import("../deployments/[id]/pause/route");
    await pausePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(adminToken, "32.0.0.1"),
        body: JSON.stringify({ reason: "Manual pause." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const requesterToken = await issueSessionFor("dan-kowalski", "32.0.0.2");
    const { POST: resumePost } = await import("../deployments/[id]/resume/route");
    const res = await resumePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/resume`, {
        method: "POST",
        headers: bearer(requesterToken, "32.0.0.2"),
        body: JSON.stringify({ reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(403);
  });

  it("200s for the admin persona and restores 'deployed'", async () => {
    const token = await issueSessionFor("ray-chen", "32.0.0.3");
    const initiativeId = await memberChatCopilotId();
    const { POST: pausePost } = await import("../deployments/[id]/pause/route");
    await pausePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(token, "32.0.0.3"),
        body: JSON.stringify({ reason: "Manual pause." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const { POST: resumePost } = await import("../deployments/[id]/resume/route");
    const res = await resumePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/resume`, {
        method: "POST",
        headers: bearer(token, "32.0.0.3"),
        body: JSON.stringify({ reason: "Maintenance complete." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.after).toBe("deployed");

    const [init] = await testDb.select().from(initiatives).where(eq(initiatives.id, initiativeId));
    expect(init!.state).toBe("deployed");
  });

  it("400s an empty reason", async () => {
    const token = await issueSessionFor("ray-chen", "32.0.0.4");
    const initiativeId = await memberChatCopilotId();
    const { POST: pausePost } = await import("../deployments/[id]/pause/route");
    await pausePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(token, "32.0.0.4"),
        body: JSON.stringify({ reason: "Manual pause." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const { POST: resumePost } = await import("../deployments/[id]/resume/route");
    const res = await resumePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/resume`, {
        method: "POST",
        headers: bearer(token, "32.0.0.4"),
        body: JSON.stringify({ reason: "" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(400);
  });
});

/* -----------------------------------------------------------------------
 * P1 fix — independent security review: pauseDeployment/resumeDeployment/
 * setEvalThreshold never received the session workspace, so an admin
 * session in one workspace could mutate another workspace's live-created
 * initiative by id. Mirrors "workspace isolation on mutation routes"
 * (app/api/__tests__/routes.test.ts) — same NotFoundError-shaped 404, no
 * existence leak.
 * -------------------------------------------------------------------- */
describe("workspace authorization on admin mutation routes (P1 fix)", () => {
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
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string; workspaceId: string };
    return { token: json.token, workspaceId: json.workspaceId };
  }

  /** A fresh initiative + one deployed deployment_versions row, tagged with
   * `workspaceId` — same direct-insert pattern as
   * lib/services/admin-service.test.ts's workspace-authorization block. */
  async function initiativeWithDeploymentInWorkspace(workspaceId: string): Promise<string> {
    const draft = await createDraft(testDb, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: { id: "priya-raman", role: "requester" },
      requesterName: "Priya Raman",
      workspaceId,
    });
    await testDb.update(initiatives).set({ state: "deployed" }).where(eq(initiatives.id, draft.initiativeId));
    await testDb.insert(deploymentVersions).values({
      id: `dep-${randomUUID()}`,
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
    return draft.initiativeId;
  }

  it("cross-workspace pause 404s with the SAME shape as an unknown initiative id (no existence leak)", async () => {
    const owner = await issueSessionWithWorkspace("ray-chen", "33.0.0.1");
    const stranger = await issueSessionWithWorkspace("ray-chen", "33.0.0.2");
    // No shared jeeves_workspace cookie between these two logins -> distinct workspaces.
    expect(stranger.workspaceId).not.toBe(owner.workspaceId);

    const initiativeId = await initiativeWithDeploymentInWorkspace(owner.workspaceId);

    const { POST: pausePost } = await import("../deployments/[id]/pause/route");
    const res = await pausePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(stranger.token, "33.0.0.2"),
        body: JSON.stringify({ reason: "trying anyway" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    // Exactly the message NotFoundError("initiative", id) produces for a
    // genuinely unknown id too — no existence leak.
    expect(json.error).toBe(`initiative not found: ${initiativeId}`);

    const [row] = await testDb.select().from(initiatives).where(eq(initiatives.id, initiativeId));
    expect(row!.state).toBe("deployed"); // unchanged — no partial write
  });

  it("the owning workspace session succeeds (control case)", async () => {
    const owner = await issueSessionWithWorkspace("ray-chen", "33.0.0.3");
    const initiativeId = await initiativeWithDeploymentInWorkspace(owner.workspaceId);

    const { POST: pausePost } = await import("../deployments/[id]/pause/route");
    const res = await pausePost(
      new Request(`http://localhost/api/admin/deployments/${initiativeId}/pause`, {
        method: "POST",
        headers: bearer(owner.token, "33.0.0.3"),
        body: JSON.stringify({ reason: "Manual pause for maintenance." }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.after).toBe("paused");
  });
});
