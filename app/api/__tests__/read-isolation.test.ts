/**
 * HTTP-layer read-isolation coverage for the P0 pass (external-review
 * finding 2: "Read isolation is inconsistent, and some live data is
 * public... Incidents, promotions and draft-run progress have
 * unauthenticated GET endpoints"). NEW file per task-brief file ownership
 * rules (route tests for surfaces this task scopes go here, not into
 * app/api/__tests__/routes.test.ts, which another agent owns).
 *
 * For each surface: a row owned by a live workspace (ws-A, created via the
 * real POST /api/initiatives -> session flow) must be
 *   (a) invisible to an anonymous caller (no session, no cookie),
 *   (b) invisible to a DIFFERENT live workspace's viewer (ws-B),
 *   (c) visible to ws-A's own viewer (bearer token OR its signed
 *       jeeves_workspace cookie alone),
 * while a seeded/null-workspace row stays
 *   (d) visible to every one of the above.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { deploymentVersions, incidents, initiatives, reviewCycles } from "@/lib/db/schema";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  process.env.JEEVES_COOKIE_SECRET = "read-isolation-test-secret";
  testDb = await createTestDb();
  await seedDatabase(testDb);
  resetGuardStateForTests();
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
});

function bearer(token: string, ip: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

function cookieOnly(workspaceCookie: string, ip: string): HeadersInit {
  return { cookie: workspaceCookie, "x-forwarded-for": ip, "content-type": "application/json" };
}

/** Issues a session, reusing `workspaceCookie` from a prior call (same-browser
 * login) when given, matching app/api/__tests__/routes.test.ts's own helper. */
async function issueSessionInWorkspace(
  personaKey: string,
  ip: string,
  workspaceCookie?: string,
): Promise<{ token: string; workspaceCookie: string }> {
  const { POST } = await import("../session/route");
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (workspaceCookie) headers["cookie"] = workspaceCookie;
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { token: string };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/jeeves_workspace=[^;]+/);
  return { token: json.token, workspaceCookie: match ? match[0] : (workspaceCookie ?? "") };
}

const CHAMPION_PAYLOAD = {
  basics: {
    title: "Prior-Auth Clinical Summarizer",
    sponsorOrg: "Clinical Ops",
    requesterName: "Priya Raman",
    requesterEmail: "priya.raman@meridianhealth-demo.example",
    businessProblem: "Prior-authorization nurses spend far too long assembling coverage packets by hand.",
  },
  useCase: {
    primaryUsers: "Prior-auth nurses",
    decisionInformed: "Coverage approval/denial recommendation",
    expectedVolume: "10k-100k/mo",
  },
  data: {
    dataSources: ["Clinical notes (Epic)"],
    phiCategories: ["Diagnosis/ICD codes"],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: "Inference-only",
  },
  modelVendor: {
    buildOrBuy: "Buy (vendor)",
    vendorName: "Halcyon Clinical AI, Inc.",
    hosting: "Vendor-hosted",
    modelType: "LLM (generative)",
  },
  populationImpact: {
    affectedPopulations: ["Members"],
    expectedBenefits: "Faster review turnaround for members awaiting care decisions.",
    expectedHarms: "Summarization errors could cause a missed clinical detail during review.",
  },
  deployment: {
    integrationPoints: ["Prior-auth workflow queue"],
    rolloutPlan: "Pilot with one team for 4 weeks with full human review before any rollout.",
  },
  overlay: {
    touchesPHI: true,
    memberFacing: true,
    careCoverageInfluence: true,
    vendorHosted: true,
    humanInTheLoop: false,
    individualImpact: true,
  },
  evidenceAttachments: [],
};

/** Creates a live initiative under the given session's workspace via the
 * real POST /api/initiatives route. Returns its id + slug. */
async function createLiveInitiative(
  token: string,
  ip: string,
): Promise<{ initiativeId: string; slug: string }> {
  const { POST } = await import("../initiatives/route");
  const res = await POST(
    new Request("http://localhost/api/initiatives", {
      method: "POST",
      headers: bearer(token, ip),
      body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { initiativeId: string; slug: string };
  return json;
}

describe("GET /api/monitor/incidents — read isolation", () => {
  it("a ws-A-owned incident is invisible to anonymous/ws-B, visible to ws-A; a seeded incident is visible to everyone", async () => {
    const { token: tokenA, workspaceCookie: cookieA } = await issueSessionInWorkspace(
      "priya-raman",
      "60.0.0.1",
    );
    const { token: tokenB, workspaceCookie: cookieB } = await issueSessionInWorkspace(
      "dan-kowalski",
      "60.0.0.2",
    );

    // Seeded/null-workspace incident, via the real monitor-run flow (any
    // authenticated session may trigger it) -> tied to member-chat-copilot,
    // a seeded (workspaceId null) initiative.
    const { POST: monitorRun } = await import("../monitor/run/route");
    const runRes = await monitorRun(
      new Request("http://localhost/api/monitor/run", { method: "POST", headers: bearer(tokenA, "60.0.0.1") }),
    );
    expect(runRes.status).toBe(200);
    expect((await runRes.json()).incidentsCreated).toBe(1);

    // ws-A-owned incident: a live initiative + a directly-inserted
    // deployment + incident row (bypassing the full breach workflow, which
    // belongs to lib/services/monitor-service.ts — not this task's file).
    const { initiativeId } = await createLiveInitiative(tokenA, "60.0.0.1");
    await testDb.insert(deploymentVersions).values({
      id: "dep-ws-a-incident",
      initiativeId,
      version: "v1.0",
      status: "deployed",
      deployedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    await testDb.insert(incidents).values({
      id: "incident-ws-a",
      deploymentId: "dep-ws-a-incident",
      controlId: "Q-01",
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      identityKey: "dep-ws-a-incident:Q-01:1",
      detectedAt: new Date("2026-07-10T00:00:00.000Z"),
      reviewCycleId: null,
      resolvedAt: null,
    });

    const { GET } = await import("../monitor/incidents/route");

    const anonRes = await GET(new Request("http://localhost/api/monitor/incidents"));
    const anonIds = ((await anonRes.json()).incidents as { id: string }[]).map((i) => i.id);
    expect(anonIds).not.toContain("incident-ws-a");
    expect(anonIds.length).toBeGreaterThanOrEqual(1); // the seeded breach is visible

    const wsBRes = await GET(
      new Request("http://localhost/api/monitor/incidents", { headers: cookieOnly(cookieB, "60.0.0.3") }),
    );
    const wsBIds = ((await wsBRes.json()).incidents as { id: string }[]).map((i) => i.id);
    expect(wsBIds).not.toContain("incident-ws-a");

    const wsBSessionRes = await GET(
      new Request("http://localhost/api/monitor/incidents", { headers: bearer(tokenB, "60.0.0.4") }),
    );
    const wsBSessionIds = ((await wsBSessionRes.json()).incidents as { id: string }[]).map((i) => i.id);
    expect(wsBSessionIds).not.toContain("incident-ws-a");

    const wsACookieRes = await GET(
      new Request("http://localhost/api/monitor/incidents", { headers: cookieOnly(cookieA, "60.0.0.5") }),
    );
    const wsACookieIds = ((await wsACookieRes.json()).incidents as { id: string }[]).map((i) => i.id);
    expect(wsACookieIds).toContain("incident-ws-a");

    const wsATokenRes = await GET(
      new Request("http://localhost/api/monitor/incidents", { headers: bearer(tokenA, "60.0.0.6") }),
    );
    const wsATokenIds = ((await wsATokenRes.json()).incidents as { id: string }[]).map((i) => i.id);
    expect(wsATokenIds).toContain("incident-ws-a");
    // The seeded incident is visible to every viewer, including ws-A.
    expect(wsATokenIds.length).toBe(wsBIds.length + 1);
  });

  it("GET() with no request at all (existing call convention) degrades to the anonymous/seeded-only view", async () => {
    const { GET } = await import("../monitor/incidents/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.incidents)).toBe(true);
    expect(json.incidents).toHaveLength(0);
  });
});

describe("GET /api/deployments/promotions — read isolation", () => {
  it("a ws-A-owned checkpoint is invisible to anonymous/ws-B, visible to ws-A; the seeded v2.1 checkpoint is visible to everyone", async () => {
    const { token: tokenA, workspaceCookie: cookieA } = await issueSessionInWorkspace(
      "priya-raman",
      "61.0.0.1",
    );
    const { token: tokenB, workspaceCookie: cookieB } = await issueSessionInWorkspace(
      "dan-kowalski",
      "61.0.0.2",
    );

    const { initiativeId, slug } = await createLiveInitiative(tokenA, "61.0.0.1");
    await testDb.insert(deploymentVersions).values({
      id: "dep-ws-a-promotion",
      initiativeId,
      version: "v9.9",
      status: "awaiting_promotion_signoff",
      deployedAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    const { GET } = await import("../deployments/promotions/route");

    const anonRes = await GET(new Request("http://localhost/api/deployments/promotions"));
    const anonSlugs = ((await anonRes.json()) as { initiativeSlug: string }[]).map((p) => p.initiativeSlug);
    expect(anonSlugs).not.toContain(slug);
    expect(anonSlugs).toContain("pa-correspondence-model"); // seeded v2.1 checkpoint

    const wsBRes = await GET(
      new Request("http://localhost/api/deployments/promotions", { headers: cookieOnly(cookieB, "61.0.0.3") }),
    );
    const wsBSlugs = ((await wsBRes.json()) as { initiativeSlug: string }[]).map((p) => p.initiativeSlug);
    expect(wsBSlugs).not.toContain(slug);
    expect(wsBSlugs).toContain("pa-correspondence-model");

    const wsBTokenRes = await GET(
      new Request("http://localhost/api/deployments/promotions", { headers: bearer(tokenB, "61.0.0.7") }),
    );
    const wsBTokenSlugs = ((await wsBTokenRes.json()) as { initiativeSlug: string }[]).map(
      (p) => p.initiativeSlug,
    );
    expect(wsBTokenSlugs).not.toContain(slug);

    const wsATokenRes = await GET(
      new Request("http://localhost/api/deployments/promotions", { headers: bearer(tokenA, "61.0.0.4") }),
    );
    const wsATokenSlugs = ((await wsATokenRes.json()) as { initiativeSlug: string }[]).map(
      (p) => p.initiativeSlug,
    );
    expect(wsATokenSlugs).toContain(slug);
    expect(wsATokenSlugs).toContain("pa-correspondence-model");

    const wsACookieRes = await GET(
      new Request("http://localhost/api/deployments/promotions", { headers: cookieOnly(cookieA, "61.0.0.5") }),
    );
    const wsACookieSlugs = ((await wsACookieRes.json()) as { initiativeSlug: string }[]).map(
      (p) => p.initiativeSlug,
    );
    expect(wsACookieSlugs).toContain(slug);
  });

  it("GET() with no request at all (existing call convention) degrades to the anonymous/seeded-only view", async () => {
    const { GET } = await import("../deployments/promotions/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { initiativeSlug: string }[];
    expect(json.some((p) => p.initiativeSlug === "pa-correspondence-model")).toBe(true);
  });
});

describe("GET /api/initiatives/[id]/draft-run — read isolation (progress polling)", () => {
  async function triageLiveInitiative(
    token: string,
    ip: string,
  ): Promise<{ initiativeId: string; cycleId: string }> {
    const { initiativeId } = await createLiveInitiative(token, ip);

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const submitRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(submitRes.status).toBe(200);

    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const triageRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(triageRes.status).toBe(200);
    const { cycleId } = (await triageRes.json()) as { cycleId: string };
    return { initiativeId, cycleId };
  }

  it("a ws-A-owned cycle's progress is invisible to anonymous/ws-B (same shape/status as an unknown cycleId), visible to ws-A", async () => {
    const { token: tokenA, workspaceCookie: cookieA } = await issueSessionInWorkspace(
      "priya-raman",
      "62.0.0.1",
    );
    const { token: tokenB, workspaceCookie: cookieB } = await issueSessionInWorkspace(
      "dan-kowalski",
      "62.0.0.2",
    );

    const { cycleId } = await triageLiveInitiative(tokenA, "62.0.0.1");

    const { GET } = await import("../initiatives/[id]/draft-run/route");

    // "No existence leak" means: the {rows, complete} SHAPE for a real but
    // invisible cycleId matches what an unknown cycleId produces — the
    // `cycleId` field itself always echoes back whatever was queried (that
    // alone reveals nothing; it's the client's own input), so it is checked
    // separately, not folded into a same-cycleId equality comparison.
    const unknownRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=does-not-exist`),
    );
    expect(unknownRes.status).toBe(200);
    const unknownJson = (await unknownRes.json()) as { rows: unknown[]; complete: boolean };
    expect(unknownJson.rows).toEqual([]);
    expect(unknownJson.complete).toBe(true);

    const anonRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`),
    );
    expect(anonRes.status).toBe(200);
    const anonJson = (await anonRes.json()) as { cycleId: string; rows: unknown[]; complete: boolean };
    expect(anonJson.cycleId).toBe(cycleId); // echoes the query param, not a leak
    expect(anonJson.rows).toEqual(unknownJson.rows);
    expect(anonJson.complete).toBe(unknownJson.complete);

    const wsBRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: cookieOnly(cookieB, "62.0.0.3"),
      }),
    );
    const wsBJson = (await wsBRes.json()) as { rows: unknown[]; complete: boolean };
    expect(wsBJson.rows).toEqual(unknownJson.rows);
    expect(wsBJson.complete).toBe(unknownJson.complete);

    const wsBTokenRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: bearer(tokenB, "62.0.0.4"),
      }),
    );
    const wsBTokenJson = (await wsBTokenRes.json()) as { rows: unknown[]; complete: boolean };
    expect(wsBTokenJson.rows).toEqual(unknownJson.rows);
    expect(wsBTokenJson.complete).toBe(unknownJson.complete);

    const wsATokenRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: bearer(tokenA, "62.0.0.5"),
      }),
    );
    expect(wsATokenRes.status).toBe(200);
    const wsAJson = (await wsATokenRes.json()) as { cycleId: string; rows: unknown[]; complete: boolean };
    expect(wsAJson.cycleId).toBe(cycleId);
    expect(wsAJson.rows.length).toBeGreaterThan(0); // real progress: pending reviews from triage
    expect(wsAJson.complete).toBe(false);

    const wsACookieRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: cookieOnly(cookieA, "62.0.0.6"),
      }),
    );
    const wsACookieJson = (await wsACookieRes.json()) as { rows: unknown[] };
    expect(wsACookieJson.rows.length).toBeGreaterThan(0);
  });

  it("a seeded cycle's progress is visible to anonymous, a foreign workspace, and any live viewer alike", async () => {
    const [seededInitiative] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "provider-dedup-agent"));
    const [seededCycle] = await testDb
      .select()
      .from(reviewCycles)
      .where(eq(reviewCycles.initiativeId, seededInitiative!.id));
    const cycleId = seededCycle!.id;

    const { token: tokenB, workspaceCookie: cookieB } = await issueSessionInWorkspace(
      "dan-kowalski",
      "62.0.1.1",
    );

    const { GET } = await import("../initiatives/[id]/draft-run/route");

    const anonRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`),
    );
    const anonJson = (await anonRes.json()) as { rows: unknown[] };
    expect(anonJson.rows.length).toBeGreaterThan(0);

    const wsBRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: cookieOnly(cookieB, "62.0.1.2"),
      }),
    );
    const wsBJson = (await wsBRes.json()) as { rows: unknown[] };
    expect(wsBJson.rows).toEqual(anonJson.rows);

    const wsBTokenRes = await GET(
      new Request(`http://localhost/api/initiatives/x/draft-run?cycleId=${cycleId}`, {
        headers: bearer(tokenB, "62.0.1.3"),
      }),
    );
    const wsBTokenJson = (await wsBTokenRes.json()) as { rows: unknown[] };
    expect(wsBTokenJson.rows).toEqual(anonJson.rows);
  });

  it("400s a missing cycleId regardless of viewer (unchanged behavior)", async () => {
    const { GET } = await import("../initiatives/[id]/draft-run/route");
    const res = await GET(new Request("http://localhost/api/initiatives/x/draft-run"));
    expect(res.status).toBe(400);
  });
});
