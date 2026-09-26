/**
 * Public (passcode-free) intake submission.
 *
 * The hard rule this replaces said public visitors are read-only. Opening
 * submission was an explicit product decision; the safety of it rests
 * entirely on ONE property, which most of this file is about:
 *
 *   a public session must not be able to spend money.
 *
 * `requester` is not merely "may submit" — it already unlocks
 * POST /api/chat/intake and the 8-domain draft-run, both budget-gated
 * against the shared OpenAI cap. So the public session carries a distinct
 * `public` role that every existing `role !== "requester"` gate rejects by
 * default, and the three intake routes opt it in explicitly.
 *
 * If someone later "simplifies" this by minting public sessions as
 * requesters, the 403 tests below are what fail first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { initiatives } from "@/lib/db/schema";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  process.env.JEEVES_COOKIE_SECRET = "public-submission-test-secret";
  testDb = await createTestDb();
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
});

function headers(token: string, ip: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
}

/** A passcode-free session, exactly as a visitor's browser would get one. */
async function publicSession(ip: string): Promise<{ token: string; workspaceId: string }> {
  const { POST } = await import("../public-session/route");
  const res = await POST(
    new Request("http://localhost/api/public-session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; workspaceId: string };
}

const PUBLIC_PAYLOAD = {
  basics: {
    title: "Appointment Reminder Summarizer",
    sponsorOrg: "Member Services",
    requesterName: "Jordan Ellis",
    requesterEmail: "jordan.ellis@meridianhealth-demo.example",
    businessProblem:
      "Members miss appointments because reminder calls are manual and inconsistently made.",
  },
  useCase: {
    primaryUsers: "Member services coordinators",
    decisionInformed: "Which members to call first",
    expectedVolume: "1k-10k/mo",
  },
  data: {
    dataSources: ["Appointment scheduling system"],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: "Inference-only",
  },
  modelVendor: {
    buildOrBuy: "Buy (vendor)",
    vendorName: "Acme Reminder AI",
    hosting: "Vendor-hosted",
    modelType: "LLM (generative)",
  },
  populationImpact: {
    affectedPopulations: ["Members"],
    expectedBenefits: "Fewer missed appointments.",
    expectedHarms: "A wrong reminder could send someone to the wrong place.",
  },
  deployment: {
    integrationPoints: ["Member outreach queue"],
    rolloutPlan: "Pilot with one team for 4 weeks with full human review before any rollout.",
  },
  overlay: {
    touchesPHI: false,
    memberFacing: true,
    careCoverageInfluence: false,
    vendorHosted: true,
    humanInTheLoop: true,
    individualImpact: false,
  },
  evidenceAttachments: [],
};

async function createAsPublic(token: string, ip: string, requestId = "public-intake-000001"): Promise<Response> {
  const { POST } = await import("../initiatives/route");
  return POST(
    new Request("http://localhost/api/initiatives", {
      method: "POST",
      headers: headers(token, ip),
      body: JSON.stringify({ payload: PUBLIC_PAYLOAD, requestId }),
    }),
  );
}

/* ------------------------------------------------------------------------
 * The money tests. These are the reason the `public` role exists.
 * --------------------------------------------------------------------- */
describe("a public session cannot spend the OpenAI budget", () => {
  it("403s on POST /api/chat/intake — the intake copilot is an LLM call", async () => {
    const { token } = await publicSession("80.0.0.1");
    const { POST } = await import("../chat/intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: headers(token, "80.0.0.2"),
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s on draft-run — one public click would otherwise run eight agents", async () => {
    const { token } = await publicSession("80.0.1.1");
    const createRes = await createAsPublic(token, "80.0.1.2");
    expect(createRes.status).toBe(200);
    const { initiativeId } = (await createRes.json()) as { initiativeId: string };

    const { POST } = await import("../initiatives/[id]/draft-run/route");
    const res = await POST(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: headers(token, "80.0.1.3"),
        body: JSON.stringify({ domains: ["legal"] }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(403);
  });

  it("403s on the auditor chat and the monitor run", async () => {
    const { token } = await publicSession("80.0.2.1");

    const { POST: auditorChat } = await import("../chat/auditor/route");
    const chatRes = await auditorChat(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: headers(token, "80.0.2.2"),
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(chatRes.status).toBe(403);

    const { POST: monitorRun } = await import("../monitor/run/route");
    const monitorRes = await monitorRun(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: headers(token, "80.0.2.3"),
      }),
    );
    expect(monitorRes.status).toBe(403);

    // agents/health had no role check and IS budget-gated — an anonymous
    // caller could otherwise have invoked the AgentPort for free.
    const { POST: agentHealth } = await import("../agents/health/route");
    const healthRes = await agentHealth(
      new Request("http://localhost/api/agents/health", {
        method: "POST",
        headers: headers(token, "80.0.2.4"),
      }),
    );
    expect(healthRes.status).toBe(403);
  });
});

/* ------------------------------------------------------------------------
 * Governance stays with named humans.
 * --------------------------------------------------------------------- */
describe("a public session holds no governance authority", () => {
  it("cannot open QC on its own submission, nor triage, nor decide", async () => {
    const { token } = await publicSession("80.1.0.1");
    const createRes = await createAsPublic(token, "80.1.0.2");
    const { initiativeId } = (await createRes.json()) as { initiativeId: string };

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const submitRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: headers(token, "80.1.0.3"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(submitRes.status).toBe(200);

    const { POST: qcPost } = await import("../initiatives/[id]/qc/route");
    const qcRes = await qcPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/qc`, {
        method: "POST",
        headers: headers(token, "80.1.0.4"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(qcRes.status).toBe(403);

    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const triageRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: headers(token, "80.1.0.5"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    // Before the guard change this route had NO role check and substituted
    // SYSTEM_ACTOR, so a public caller could have fired the 8-domain fan-out
    // on their own initiative, stepping over the Program Office entirely.
    expect(triageRes.status).toBe(403);

    const { POST: decidePost } = await import("../initiatives/[id]/decide/route");
    const decideRes = await decidePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/decide`, {
        method: "POST",
        headers: headers(token, "80.1.0.6"),
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(decideRes.status).toBe(403);
  });

  it("403s on the admin surfaces", async () => {
    const { token } = await publicSession("80.1.1.1");
    const { POST } = await import("../admin/threshold/route");
    const res = await POST(
      new Request("http://localhost/api/admin/threshold", {
        method: "POST",
        headers: headers(token, "80.1.1.2"),
        body: JSON.stringify({ controlId: "Q-01", deploymentId: "d1", value: 1, reason: "x" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------------
 * What it CAN do — the feature itself.
 * --------------------------------------------------------------------- */
describe("a visitor with no passcode can submit a request", () => {
  it("creates a draft and submits it, ending at `submitted`", async () => {
    const { token } = await publicSession("80.2.0.1");

    const createRes = await createAsPublic(token, "80.2.0.2");
    expect(createRes.status).toBe(200);
    const { initiativeId } = (await createRes.json()) as { initiativeId: string };

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const submitRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: headers(token, "80.2.0.3"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(submitRes.status).toBe(200);

    const [row] = await testDb.select().from(initiatives).where(eq(initiatives.id, initiativeId));
    expect(row!.state).toBe("submitted");
    // The name on the record comes from what they typed, not from a demo
    // persona — there is no ACTOR_DIRECTORY entry for a public submitter.
    expect(row!.requester).toBe("Jordan Ellis");
  });

  it("cannot touch another visitor's draft — 404, the same shape as an unknown id", async () => {
    const first = await publicSession("80.2.1.1");
    const createRes = await createAsPublic(first.token, "80.2.1.2", "public-intake-000002");
    const { initiativeId } = (await createRes.json()) as { initiativeId: string };

    const second = await publicSession("80.2.1.3");
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const res = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: headers(second.token, "80.2.1.4"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(404);
  });

  it("rate-limits session minting per client, so the door is not a firehose", async () => {
    const { POST } = await import("../public-session/route");
    let sawLimit = false;
    for (let i = 0; i < 40; i += 1) {
      const res = await POST(
        new Request("http://localhost/api/public-session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "80.3.0.1" },
        }),
      );
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });

  it("still enforces the body-size cap and the payload schema", async () => {
    const { token } = await publicSession("80.4.0.1");
    const { POST } = await import("../initiatives/route");

    const huge = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: headers(token, "80.4.0.2"),
        body: JSON.stringify({
          payload: PUBLIC_PAYLOAD,
          requestId: "public-intake-000003",
          filler: "x".repeat(70_000),
        }),
      }),
    );
    expect(huge.status).toBe(413);

    const malformed = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: headers(token, "80.4.0.3"),
        body: JSON.stringify({ payload: { basics: {} }, requestId: "public-intake-000004" }),
      }),
    );
    expect(malformed.status).toBe(400);
  });
});

/* ------------------------------------------------------------------------
 * The queue. Without it the feature is pointless: each public session gets
 * its own workspace, so a real request lands where nobody else can see it.
 *
 * It is guarded by OPERATOR_TOKEN, a server-side secret — NOT by persona
 * role. Main's passwordless playground hands any visitor any persona in one
 * click, Program Office and Admin included, so a role-gated queue would show
 * every stranger's request (name, email, what they typed) to every other
 * stranger. The persona test below is the lock on that.
 * --------------------------------------------------------------------- */
describe("the operator's inbound request queue", () => {
  const OPERATOR_TOKEN = "op-test-token-0123456789abcdefghijklmnop"; // >= 32 chars

  afterEach(() => {
    delete process.env.OPERATOR_TOKEN;
  });

  async function demoSession(personaKey: string, ip: string): Promise<string> {
    const { POST } = await import("../session/route");
    const res = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ personaKey }),
      }),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  async function readQueue(authorization?: string, ip = "80.5.9.9"): Promise<Response> {
    const { GET } = await import("../public-intake/route");
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (authorization) headers.authorization = authorization;
    return GET(new Request("http://localhost/api/public-intake", { headers }));
  }

  it("shows the operator what the public has sent, with the address to reply to", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    const visitor = await publicSession("80.5.0.1");
    const createRes = await createAsPublic(visitor.token, "80.5.0.2", "public-intake-000010");
    expect(createRes.status).toBe(200);

    const res = await readQueue(`Bearer ${OPERATOR_TOKEN}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { title: string; requester: string; requesterEmail: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Appointment Reminder Summarizer");
    expect(rows[0]!.requester).toBe("Jordan Ellis");
    // The queue exists so someone can reply. Without the address it can't.
    expect(rows[0]!.requesterEmail).toBe("jordan.ellis@meridianhealth-demo.example");
  });

  it("is closed to a Program Office persona — personas are free to anyone now", async () => {
    // The decisive test. In the passwordless playground one click makes any
    // visitor Nia Okafor. If that opened the queue, strangers would read each
    // other's requests.
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    for (const persona of ["nia-okafor", "ray-chen", "angela-torres"]) {
      const token = await demoSession(persona, `80.5.1.${persona.length}`);
      const res = await readQueue(`Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it("is closed to a public session and to an anonymous caller", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    const visitor = await publicSession("80.5.2.1");
    expect((await readQueue(`Bearer ${visitor.token}`)).status).toBe(401);
    expect((await readQueue()).status).toBe(401);
  });

  it("rejects a wrong token, including one that differs only at the end", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    expect((await readQueue(`Bearer ${OPERATOR_TOKEN.slice(0, -1)}X`)).status).toBe(401);
    expect((await readQueue(`Bearer ${OPERATOR_TOKEN}extra`)).status).toBe(401);
    expect((await readQueue(OPERATOR_TOKEN)).status).toBe(401); // no scheme
  });

  it("does not exist until an operator token is configured", async () => {
    // Off by default: no configuration, no queue — rather than a queue that
    // anything, or nothing, can open.
    delete process.env.OPERATOR_TOKEN;
    expect((await readQueue("Bearer anything")).status).toBe(404);
  });

  it("refuses a short token as though none were configured", async () => {
    // A guessable operator secret would make the rest of this moot.
    process.env.OPERATOR_TOKEN = "short-token";
    expect((await readQueue("Bearer short-token")).status).toBe(404);
  });

  it("rate-limits failed attempts", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      limited = (await readQueue("Bearer wrong-token-attempt", "80.5.3.1")).status === 429;
    }
    expect(limited).toBe(true);
  });

  it("lists only real requests, not playground role-play", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    const requesterToken = await demoSession("priya-raman", "80.5.4.1");
    const { POST: createInitiative } = await import("../initiatives/route");
    const created = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: headers(requesterToken, "80.5.4.2"),
        body: JSON.stringify({ payload: PUBLIC_PAYLOAD, requestId: "demo-session-000011" }),
      }),
    );
    expect(created.status).toBe(200);

    const res = await readQueue(`Bearer ${OPERATOR_TOKEN}`);
    expect((await res.json()) as unknown[]).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------
 * The two doors must not leak into each other.
 *
 * Main's /api/session lets a session act as the PARENT of a persona switch,
 * and the new persona inherits the parent's workspace. A real-request
 * session is a valid session — so without a guard, a visitor who sent a
 * real request and then clicked "Try the demo" got playground personas
 * INSIDE the real-request workspace: free to QC and approve their own real
 * request, and with every sample initiative they created afterwards landing
 * in the operator's queue.
 * --------------------------------------------------------------------- */
describe("a real-request session never becomes a playground workspace", () => {
  const OPERATOR_TOKEN = "op-test-token-0123456789abcdefghijklmnop";
  afterEach(() => {
    delete process.env.OPERATOR_TOKEN;
  });

  async function switchPersona(parentToken: string, personaKey: string, ip: string) {
    const { POST } = await import("../session/route");
    return POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          authorization: `Bearer ${parentToken}`,
        },
        body: JSON.stringify({ personaKey }),
      }),
    );
  }

  it("does not hand its workspace to a persona switched into from it", async () => {
    const visitor = await publicSession("80.6.0.1");
    expect(visitor.workspaceId.startsWith("public-")).toBe(true);

    const res = await switchPersona(visitor.token, "nia-okafor", "80.6.0.2");
    expect(res.status).toBe(200);
    const persona = (await res.json()) as { workspaceId: string };
    expect(persona.workspaceId).not.toBe(visitor.workspaceId);
    expect(persona.workspaceId.startsWith("public-")).toBe(false);
    // Nor may the browser's workspace cookie be pinned to it.
    expect(res.headers.get("set-cookie") ?? "").not.toContain("public-");
  });

  it("cannot be minted through the persona door with a chosen id", async () => {
    // resolveActor() recognises `public:<id>` keys, because real-request
    // sessions store one. The persona endpoint must not: it would let a caller
    // pick their own actor id and skip the real-request rate limit.
    const { POST } = await import("../session/route");
    const res = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "80.6.2.1" },
        body: JSON.stringify({ personaKey: "public:chosen-by-caller" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("keeps playground records created afterwards out of the operator's queue", async () => {
    process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;
    const visitor = await publicSession("80.6.1.1");
    const res = await switchPersona(visitor.token, "priya-raman", "80.6.1.2");
    const { token: playToken } = (await res.json()) as { token: string };

    const created = await createAsPublic(playToken, "80.6.1.3", "playground-after-000001");
    expect(created.status).toBe(200);

    const { GET } = await import("../public-intake/route");
    const queue = await GET(
      new Request("http://localhost/api/public-intake", {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}`, "x-forwarded-for": "80.6.1.4" },
      }),
    );
    expect((await queue.json()) as unknown[]).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------
 * Seeded demo data is out of reach.
 *
 * The seeded champion initiative (`init-1`, a predictable id) is an
 * unsubmitted draft in the shared null workspace. Before main's strict
 * shared-row rule, a public session passed every authorization check on it
 * and was stopped only by an incidental crash in the completeness check —
 * an anonymous-reachable 500. It must be a clean 404, with nothing changed.
 * --------------------------------------------------------------------- */
describe("seeded demo data", () => {
  it("a real-request session cannot submit or edit the seeded champion draft", async () => {
    const { seedDatabase } = await import("@/scripts/seed");
    await seedDatabase(testDb);
    const [seeded] = await testDb.select().from(initiatives).where(eq(initiatives.state, "intake_draft"));
    expect(seeded?.workspaceId).toBeNull();

    const { token } = await publicSession("80.7.0.1");
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const submitRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${seeded!.id}/submit`, {
        method: "POST",
        headers: headers(token, "80.7.0.2"),
      }),
      { params: Promise.resolve({ id: seeded!.id }) },
    );
    expect(submitRes.status).toBe(404);

    const { PUT } = await import("../initiatives/[id]/intake/route");
    const editRes = await PUT(
      new Request(`http://localhost/api/initiatives/${seeded!.id}/intake`, {
        method: "PUT",
        headers: headers(token, "80.7.0.3"),
        body: JSON.stringify({ payload: PUBLIC_PAYLOAD, expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: seeded!.id }) },
    );
    expect(editRes.status).toBe(404);

    const [after] = await testDb.select().from(initiatives).where(eq(initiatives.id, seeded!.id));
    expect(after!.state).toBe("intake_draft");
    expect(after!.title).toBe(seeded!.title);
  });
});
