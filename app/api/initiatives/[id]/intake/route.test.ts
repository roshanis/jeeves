import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "@/lib/db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { createDraft } from "@/lib/services/initiative-service";
import { ACTOR_DIRECTORY } from "@/lib/services/actors";
import { intakePayloadSchema } from "@/lib/services/intake-payload-schema";
import { EXPANDED_INTAKE } from "@/tests/fixtures/expanded-intake";

const state = vi.hoisted(() => ({
  db: null as TestDb | null,
  actor: null as (typeof ACTOR_DIRECTORY)[keyof typeof ACTOR_DIRECTORY] | null,
  workspaceId: null as string | null,
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/lib/services/route-guard", () => ({
  extractSessionToken: () => "test-token",
  resolveSession: async () => ({ actor: state.actor, workspaceId: state.workspaceId }),
  runMutationGuard: async () => state.actor
    ? { ok: true, actor: state.actor, workspaceId: state.workspaceId }
    : { ok: false, failure: { status: 401, message: "invalid or missing session" } },
}));

import { GET, PUT } from "./route";

const owner = ACTOR_DIRECTORY["priya-raman"];
const otherRequester = ACTOR_DIRECTORY["dan-kowalski"];
const reviewer = ACTOR_DIRECTORY["marcus-webb"];

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/initiatives/id/intake", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/initiatives/[id]/intake", () => {
  let db: TestDb;
  let initiativeId: string;

  beforeEach(async () => {
    db = await createTestDb();
    state.db = db;
    state.actor = owner;
    state.workspaceId = "ws-owner";
    ({ initiativeId } = await createDraft(db, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: owner,
      requesterName: owner.name,
      workspaceId: "ws-owner",
      requestId: "route-intake-test-key-0001",
    }));
  });

  afterEach(async () => {
    state.db = null;
    await closeTestDb(db);
  });

  it("lets the authenticated owning requester read and update the draft", async () => {
    const read = await GET(new Request("http://localhost"), context(initiativeId));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ initiativeId, version: 1 });

    const payload = {
      ...CHAMPION_PREFILL_PAYLOAD,
      basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "Updated title" },
    };
    const update = await PUT(
      putRequest({ payload, expectedVersion: 1 }),
      context(initiativeId),
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ initiativeId, version: 2, payload });
  });

  it("returns 404 for a foreign workspace before revealing requester ownership", async () => {
    state.actor = otherRequester;
    state.workspaceId = "ws-foreign";
    const response = await GET(new Request("http://localhost"), context(initiativeId));
    expect(response.status).toBe(404);
  });

  it("saves and reloads the additional answers without dropping any", async () => {
    const update = await PUT(putRequest({ payload: EXPANDED_INTAKE, expectedVersion: 1 }), context(initiativeId));
    expect(update.status).toBe(200);
    const read = await GET(new Request("http://localhost"), context(initiativeId));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ version: 2, payload: EXPANDED_INTAKE });
  });

  it("reopens historical drafts with unanswered optional fields and accepts create retries", async () => {
    const read = await GET(new Request("http://localhost"), context(initiativeId));
    expect(await read.json()).toMatchObject({ payload: { deployment: { fallbackPlan: null } } });
    const retried = await createDraft(db, {
      payload: intakePayloadSchema.parse(CHAMPION_PREFILL_PAYLOAD),
      requesterActor: owner,
      requesterName: owner.name,
      workspaceId: "ws-owner",
      requestId: "route-intake-test-key-0001",
    });
    expect(retried.initiativeId).toBe(initiativeId);
  });

  it("treats shared seed-style drafts as read-only for a live workspace", async () => {
    const seeded = await createDraft(db, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: owner,
      requesterName: owner.name,
    });
    expect((await GET(new Request("http://localhost"), context(seeded.initiativeId))).status).toBe(404);
    expect((await PUT(
      putRequest({ payload: CHAMPION_PREFILL_PAYLOAD, expectedVersion: 1 }),
      context(seeded.initiativeId),
    )).status).toBe(404);
  });

  it("returns 403 for a different requester in the owning workspace", async () => {
    state.actor = otherRequester;
    const response = await GET(new Request("http://localhost"), context(initiativeId));
    expect(response.status).toBe(403);
  });

  it("rejects a non-requester before reading or updating a draft", async () => {
    state.actor = reviewer;
    expect((await GET(new Request("http://localhost"), context(initiativeId))).status).toBe(403);
    expect((await PUT(
      putRequest({ payload: CHAMPION_PREFILL_PAYLOAD, expectedVersion: 1 }),
      context(initiativeId),
    )).status).toBe(403);
  });

  it.each([null, []])("returns 400 for a %j request body", async (body) => {
    const response = await PUT(putRequest(body), context(initiativeId));
    expect(response.status).toBe(400);
  });

  it("maps a stale expected version to 409", async () => {
    const response = await PUT(
      putRequest({ payload: CHAMPION_PREFILL_PAYLOAD, expectedVersion: 2 }),
      context(initiativeId),
    );
    expect(response.status).toBe(409);
  });

  it("rejects a body larger than 64KB", async () => {
    const response = await PUT(
      new Request("http://localhost/api/initiatives/id/intake", {
        method: "PUT",
        body: "x".repeat(64_001),
      }),
      context(initiativeId),
    );
    expect(response.status).toBe(413);
  });
});
