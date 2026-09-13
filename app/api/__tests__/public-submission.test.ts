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
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { initiatives } from "@/lib/db/schema";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  process.env.JEEVES_COOKIE_SECRET = "public-submission-test-secret";
  testDb = await createTestDb();
  resetGuardStateForTests();
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
 * its own workspace, so a submission lands where nobody on the governance
 * side can see it.
 * --------------------------------------------------------------------- */
describe("the public intake queue", () => {
  async function demoSession(personaKey: string, ip: string): Promise<string> {
    const { POST } = await import("../session/route");
    const res = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ passcode: PASSCODE, personaKey }),
      }),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  it("shows the Program Office what the public has sent in", async () => {
    const visitor = await publicSession("80.5.0.1");
    const createRes = await createAsPublic(visitor.token, "80.5.0.2", "public-intake-000010");
    expect(createRes.status).toBe(200);

    const programToken = await demoSession("nia-okafor", "80.5.0.3");
    const { GET } = await import("../public-intake/route");
    const res = await GET(
      new Request("http://localhost/api/public-intake", {
        headers: headers(programToken, "80.5.0.4"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { title: string; requester: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Appointment Reminder Summarizer");
    expect(rows[0]!.requester).toBe("Jordan Ellis");
  });

  it("is closed to a requester persona, and to the public itself", async () => {
    const { GET } = await import("../public-intake/route");

    const requesterToken = await demoSession("priya-raman", "80.5.1.1");
    const requesterRes = await GET(
      new Request("http://localhost/api/public-intake", {
        headers: headers(requesterToken, "80.5.1.2"),
      }),
    );
    expect(requesterRes.status).toBe(403);

    // The decisive one: a stranger must not be able to read other
    // strangers' submissions. The console is public, so this is the only
    // thing standing between one visitor and another's form.
    const visitor = await publicSession("80.5.1.3");
    const visitorRes = await GET(
      new Request("http://localhost/api/public-intake", {
        headers: headers(visitor.token, "80.5.1.4"),
      }),
    );
    expect(visitorRes.status).toBe(403);

    const anonRes = await GET(new Request("http://localhost/api/public-intake"));
    expect(anonRes.status).toBe(401);
  });

  it("does not list passcode-session initiatives — only public ones", async () => {
    const requesterToken = await demoSession("priya-raman", "80.5.2.1");
    const { POST: createInitiative } = await import("../initiatives/route");
    const created = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: headers(requesterToken, "80.5.2.2"),
        body: JSON.stringify({ payload: PUBLIC_PAYLOAD, requestId: "demo-session-000011" }),
      }),
    );
    expect(created.status).toBe(200);

    const programToken = await demoSession("nia-okafor", "80.5.2.3");
    const { GET } = await import("../public-intake/route");
    const res = await GET(
      new Request("http://localhost/api/public-intake", {
        headers: headers(programToken, "80.5.2.4"),
      }),
    );
    expect((await res.json()) as unknown[]).toHaveLength(0);
  });
});
