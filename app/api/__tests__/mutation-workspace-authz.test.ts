import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import {
  deploymentVersions,
  effectiveControls,
  initiatives,
  sessions,
} from "@/lib/db/schema";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "workspace-authz-route-tests";
const FULL_ATTESTATION = {
  feedbackDataSource: "Synthetic member-feedback archive.",
  consentBasis: "Fictional demo consent basis.",
  reviewedBy: "Angela Torres",
};

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  process.env.JEEVES_COOKIE_SECRET = "workspace-authz-route-secret";
  testDb = await createTestDb();
  await seedDatabase(testDb);
  resetGuardStateForTests();
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
});

function bearer(token: string, ip: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
}

async function issueSession(
  personaKey: string,
  ip: string,
  workspaceCookie?: string,
): Promise<{ token: string; workspaceCookie: string }> {
  const { POST } = await import("../session/route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
  if (workspaceCookie) headers.cookie = workspaceCookie;
  const response = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  const cookie = response.headers.get("set-cookie")?.match(/jeeves_workspace=[^;]+/)?.[0];
  return { token: body.token, workspaceCookie: cookie ?? workspaceCookie ?? "" };
}

const CHAMPION_PAYLOAD = {
  ...CHAMPION_PREFILL_PAYLOAD,
  basics: {
    ...CHAMPION_PREFILL_PAYLOAD.basics,
    title: "Workspace Boundary Initiative",
  },
};

async function createLiveInitiative(
  token: string,
  ip: string,
): Promise<string> {
  const { POST } = await import("../initiatives/route");
  const response = await POST(
    new Request("http://localhost/api/initiatives", {
      method: "POST",
      headers: bearer(token, ip),
      body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { initiativeId: string }).initiativeId;
}

async function expectSameNotFoundShape(
  foreignResponse: Response,
  unknownResponse: Response,
  foreignId: string,
  unknownId: string,
): Promise<void> {
  expect(foreignResponse.status).toBe(404);
  expect(unknownResponse.status).toBe(404);
  const foreign = (await foreignResponse.json()) as { error: string };
  const unknown = (await unknownResponse.json()) as { error: string };
  expect(foreign.error.replace(foreignId, "<id>")).toBe(
    unknown.error.replace(unknownId, "<id>"),
  );
}

async function createWorkspacePair(personaKey: string, ipBase: string) {
  const owner = await issueSession(personaKey, `${ipBase}.1`);
  const foreign = await issueSession(personaKey, `${ipBase}.2`);
  return { owner, foreign };
}

describe("remaining mutation routes enforce session workspace authorization", () => {
  it("submit returns the unknown-id 404 shape before ownership/state checks, while owner and shared rows remain mutable", async () => {
    const { owner, foreign } = await createWorkspacePair("priya-raman", "70.0.0");
    const initiativeId = await createLiveInitiative(owner.token, "70.0.0.3");
    await testDb
      .update(initiatives)
      .set({ state: "deployed" })
      .where(eq(initiatives.id, initiativeId));

    const { POST } = await import("../initiatives/[id]/submit/route");
    const foreignResponse = await POST(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.0.4"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const unknownId = "initiative-missing";
    const unknownResponse = await POST(
      new Request(`http://localhost/api/initiatives/${unknownId}/submit`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.0.5"),
      }),
      { params: Promise.resolve({ id: unknownId }) },
    );
    await expectSameNotFoundShape(foreignResponse, unknownResponse, initiativeId, unknownId);

    await testDb
      .update(initiatives)
      .set({ state: "intake_draft" })
      .where(eq(initiatives.id, initiativeId));
    const ownerResponse = await POST(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(owner.token, "70.0.0.6"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerResponse.status).toBe(200);

    const sharedId = await createLiveInitiative(owner.token, "70.0.0.8");
    await testDb
      .update(initiatives)
      .set({ workspaceId: null })
      .where(eq(initiatives.id, sharedId));
    const sharedResponse = await POST(
      new Request(`http://localhost/api/initiatives/${sharedId}/submit`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.0.7"),
      }),
      { params: Promise.resolve({ id: sharedId }) },
    );
    expect(sharedResponse.status).toBe(200);
  });

  it("triage returns 404 before wrong-state validation and allows owner/shared triage", async () => {
    const { owner, foreign } = await createWorkspacePair("priya-raman", "70.0.1");
    const initiativeId = await createLiveInitiative(owner.token, "70.0.1.3");
    const { POST } = await import("../initiatives/[id]/triage/route");

    const foreignResponse = await POST(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.1.4"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const unknownId = "initiative-missing";
    const unknownResponse = await POST(
      new Request(`http://localhost/api/initiatives/${unknownId}/triage`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.1.5"),
      }),
      { params: Promise.resolve({ id: unknownId }) },
    );
    await expectSameNotFoundShape(foreignResponse, unknownResponse, initiativeId, unknownId);

    const { POST: submit } = await import("../initiatives/[id]/submit/route");
    const ownerSubmit = await submit(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(owner.token, "70.0.1.6"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerSubmit.status).toBe(200);
    const ownerTriage = await POST(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(owner.token, "70.0.1.7"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerTriage.status).toBe(200);

    const sharedId = await createLiveInitiative(owner.token, "70.0.1.10");
    await testDb
      .update(initiatives)
      .set({ workspaceId: null })
      .where(eq(initiatives.id, sharedId));
    const sharedSubmit = await submit(
      new Request(`http://localhost/api/initiatives/${sharedId}/submit`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.1.8"),
      }),
      { params: Promise.resolve({ id: sharedId }) },
    );
    expect(sharedSubmit.status).toBe(200);
    const sharedTriage = await POST(
      new Request(`http://localhost/api/initiatives/${sharedId}/triage`, {
        method: "POST",
        headers: bearer(foreign.token, "70.0.1.9"),
      }),
      { params: Promise.resolve({ id: sharedId }) },
    );
    expect(sharedTriage.status).toBe(200);
  });

  it("checkpoint promotion scopes through the deployment's owning initiative", async () => {
    const requester = await issueSession("priya-raman", "70.0.2.1");
    const initiativeId = await createLiveInitiative(requester.token, "70.0.2.2");
    const owner = await issueSession("angela-torres", "70.0.2.3", requester.workspaceCookie);
    const foreign = await issueSession("angela-torres", "70.0.2.4");
    const deploymentId = "dep-private-promotion";
    await testDb.insert(deploymentVersions).values({
      id: deploymentId,
      initiativeId,
      version: "v-private",
      status: "awaiting_promotion_signoff",
      deployedAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    const { POST } = await import("../deployments/promotions/[id]/promote/route");
    const body = { attestation: FULL_ATTESTATION, reason: "Reviewed provenance." };
    const call = (id: string, token: string, ip: string) =>
      POST(
        new Request(`http://localhost/api/deployments/promotions/${id}/promote`, {
          method: "POST",
          headers: bearer(token, ip),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );

    await expectSameNotFoundShape(
      await call(deploymentId, foreign.token, "70.0.2.5"),
      await call("dep-missing", foreign.token, "70.0.2.6"),
      deploymentId,
      "dep-missing",
    );
    expect((await call(deploymentId, owner.token, "70.0.2.7")).status).toBe(200);

    const [sharedCheckpoint] = await testDb
      .select()
      .from(deploymentVersions)
      .where(eq(deploymentVersions.status, "awaiting_promotion_signoff"));
    expect((await call(sharedCheckpoint!.id, foreign.token, "70.0.2.8")).status).toBe(200);
  });

  it("project threshold override returns the unknown-initiative 404 shape and preserves owner/shared access", async () => {
    const requester = await issueSession("priya-raman", "70.0.3.1");
    const initiativeId = await createLiveInitiative(requester.token, "70.0.3.2");
    const owner = await issueSession("ray-chen", "70.0.3.3", requester.workspaceCookie);
    const foreign = await issueSession("ray-chen", "70.0.3.4");
    const deploymentId = "dep-private-threshold";
    await testDb
      .update(initiatives)
      .set({ state: "deployed", tier: "high" })
      .where(eq(initiatives.id, initiativeId));
    await testDb.insert(deploymentVersions).values({
      id: deploymentId,
      initiativeId,
      version: "v1",
      status: "deployed",
      deployedAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    await testDb.insert(effectiveControls).values({
      id: "ec-private-threshold",
      deploymentId,
      controlId: "Q-01",
      version: 1,
      status: "met",
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    const { POST } = await import("../admin/threshold/route");
    const call = (id: string, token: string, ip: string) =>
      POST(
        new Request("http://localhost/api/admin/threshold", {
          method: "POST",
          headers: bearer(token, ip),
          body: JSON.stringify({
            controlId: "Q-01",
            initiativeId: id,
            value: 0.061,
            reason: "Scoped threshold update.",
          }),
        }),
      );

    await expectSameNotFoundShape(
      await call(initiativeId, foreign.token, "70.0.3.5"),
      await call("initiative-missing", foreign.token, "70.0.3.6"),
      initiativeId,
      "initiative-missing",
    );
    expect((await call(initiativeId, owner.token, "70.0.3.7")).status).toBe(200);

    const [shared] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    expect((await call(shared!.id, foreign.token, "70.0.3.8")).status).toBe(200);
  });

  it("pause returns 404 before state validation and allows owner/shared mutations", async () => {
    const requester = await issueSession("priya-raman", "70.0.4.1");
    const initiativeId = await createLiveInitiative(requester.token, "70.0.4.2");
    const owner = await issueSession("ray-chen", "70.0.4.3", requester.workspaceCookie);
    const foreign = await issueSession("ray-chen", "70.0.4.4");
    const deploymentId = "dep-private-pause";
    await testDb
      .update(initiatives)
      .set({ state: "paused", tier: "high" })
      .where(eq(initiatives.id, initiativeId));
    await testDb.insert(deploymentVersions).values({
      id: deploymentId,
      initiativeId,
      version: "v1",
      status: "paused",
      deployedAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    const { POST } = await import("../admin/deployments/[id]/pause/route");
    const call = (id: string, token: string, ip: string) =>
      POST(
        new Request(`http://localhost/api/admin/deployments/${id}/pause`, {
          method: "POST",
          headers: bearer(token, ip),
          body: JSON.stringify({ reason: "Scoped pause." }),
        }),
        { params: Promise.resolve({ id }) },
      );
    await expectSameNotFoundShape(
      await call(initiativeId, foreign.token, "70.0.4.5"),
      await call("initiative-missing", foreign.token, "70.0.4.6"),
      initiativeId,
      "initiative-missing",
    );

    await testDb
      .update(initiatives)
      .set({ state: "deployed" })
      .where(eq(initiatives.id, initiativeId));
    await testDb
      .update(deploymentVersions)
      .set({ status: "deployed" })
      .where(eq(deploymentVersions.id, deploymentId));
    expect((await call(initiativeId, owner.token, "70.0.4.7")).status).toBe(200);

    const [shared] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    expect((await call(shared!.id, foreign.token, "70.0.4.8")).status).toBe(200);
  });

  it("resume returns the unknown-initiative 404 shape and allows owner/shared mutations", async () => {
    const requester = await issueSession("priya-raman", "70.0.5.1");
    const initiativeId = await createLiveInitiative(requester.token, "70.0.5.2");
    const owner = await issueSession("ray-chen", "70.0.5.3", requester.workspaceCookie);
    const foreign = await issueSession("ray-chen", "70.0.5.4");
    const deploymentId = "dep-private-resume";
    await testDb
      .update(initiatives)
      .set({ state: "paused", tier: "high" })
      .where(eq(initiatives.id, initiativeId));
    await testDb.insert(deploymentVersions).values({
      id: deploymentId,
      initiativeId,
      version: "v1",
      status: "paused",
      deployedAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    const { POST } = await import("../admin/deployments/[id]/resume/route");
    const call = (id: string, token: string, ip: string) =>
      POST(
        new Request(`http://localhost/api/admin/deployments/${id}/resume`, {
          method: "POST",
          headers: bearer(token, ip),
          body: JSON.stringify({ reason: "Scoped resume." }),
        }),
        { params: Promise.resolve({ id }) },
      );
    await expectSameNotFoundShape(
      await call(initiativeId, foreign.token, "70.0.5.5"),
      await call("initiative-missing", foreign.token, "70.0.5.6"),
      initiativeId,
      "initiative-missing",
    );
    expect((await call(initiativeId, owner.token, "70.0.5.7")).status).toBe(200);

    const [shared] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    await testDb
      .update(initiatives)
      .set({ state: "paused" })
      .where(eq(initiatives.id, shared!.id));
    await testDb
      .update(deploymentVersions)
      .set({ status: "paused" })
      .where(eq(deploymentVersions.initiativeId, shared!.id));
    expect((await call(shared!.id, foreign.token, "70.0.5.8")).status).toBe(200);
  });

  it("monitor filters foreign deployments inside the service before evaluation or pause", async () => {
    const owner = await issueSession("priya-raman", "70.0.6.1");
    const foreign = await issueSession("priya-raman", "70.0.6.2");
    const [breachInitiative] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    const [ownerSession] = await testDb
      .select({ workspaceId: sessions.workspaceId })
      .from(sessions)
      .where(eq(sessions.token, owner.token));
    await testDb
      .update(initiatives)
      .set({ workspaceId: ownerSession!.workspaceId })
      .where(eq(initiatives.id, breachInitiative!.id));

    const { POST } = await import("../monitor/run/route");
    const call = (token: string, ip: string) =>
      POST(
        new Request("http://localhost/api/monitor/run", {
          method: "POST",
          headers: bearer(token, ip),
          body: JSON.stringify({}),
        }),
      );

    const foreignResponse = await call(foreign.token, "70.0.6.3");
    expect(foreignResponse.status).toBe(200);
    expect(((await foreignResponse.json()) as { incidentsCreated: number }).incidentsCreated).toBe(0);
    const [afterForeign] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, breachInitiative!.id));
    expect(afterForeign!.state).toBe("deployed");

    const ownerResponse = await call(owner.token, "70.0.6.4");
    expect(ownerResponse.status).toBe(200);
    expect(((await ownerResponse.json()) as { incidentsCreated: number }).incidentsCreated).toBe(1);
  });
});
