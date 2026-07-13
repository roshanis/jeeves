/**
 * HTTP-layer tests for the app/api/** route handlers (task brief deliverable
 * 3 + test list: "route auth (401 without session, 200 with; rate-limit 429
 * after burst; budget 429 when exhausted); role-from-session not body").
 *
 * `@/lib/db/client`'s `getDb` is mocked to return a fresh in-memory PGlite
 * test DB (real migrations) so route handlers exercise real Drizzle
 * queries end-to-end without touching the dev PGlite store or Neon.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  testDb = await createTestDb();
  resetGuardStateForTests();
});

afterEach(async () => {
  await closeTestDb(testDb);
});

function bearer(token: string, ip = "1.1.1.1"): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

async function issueSessionFor(personaKey: string): Promise<string> {
  const { POST } = await import("../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: PASSCODE, personaKey }),
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { token: string };
  return json.token;
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

describe("POST /api/session", () => {
  it("issues a session for a correct passcode", async () => {
    const { POST } = await import("../session/route");
    const res = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "priya-raman" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBeTruthy();
  });

  it("401s a wrong passcode with no session issued", async () => {
    const { POST } = await import("../session/route");
    const res = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "wrong", personaKey: "priya-raman" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/initiatives — auth + role-from-session", () => {
  it("401s an unauthenticated request with no side effects", async () => {
    const { POST } = await import("../initiatives/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("200s with a valid requester session and creates the draft", async () => {
    const token = await issueSessionFor("priya-raman");
    const { POST } = await import("../initiatives/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, "3.3.3.3"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.initiativeId).toBeTruthy();
  });

  it("ignores a role claim in the body — resolves role from the session only", async () => {
    // elena-vasquez is a REVIEWER in the actor directory, not a requester;
    // even if the body claims role: 'requester', createDraft must still be
    // gated by the session-resolved role (reviewer), so this 403s.
    const token = await issueSessionFor("elena-vasquez");
    const { POST } = await import("../initiatives/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, "4.4.4.4"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, role: "requester" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("429s after a rate-limit burst from the same client", async () => {
    const token = await issueSessionFor("priya-raman");
    const { POST } = await import("../initiatives/route");
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) {
      last = await POST(
        new Request("http://localhost/api/initiatives", {
          method: "POST",
          headers: bearer(token, "5.5.5.5"),
          body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
        }),
      );
    }
    expect(last!.status).toBe(429);
  });
});

describe("full champion route chain: submit -> triage -> draft-run -> sign -> decide", () => {
  it("walks the champion storyline end-to-end via HTTP handlers", async () => {
    const requesterToken = await issueSessionFor("priya-raman");
    const reviewerToken = await issueSessionFor("elena-vasquez");
    const approverToken = await issueSessionFor("angela-torres");

    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const submitRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json();
    expect(submitJson.submitted).toBe(true);

    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const triageRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(triageRes.status).toBe(200);
    const triageJson = await triageRes.json();
    expect(triageJson.tier).toBe("critical");
    expect(triageJson.branch).toBe("review");
    const cycleId = triageJson.cycleId as string;

    const { POST: draftRunPost, GET: draftRunGet } = await import("../initiatives/[id]/draft-run/route");
    const draftRunRes = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
        // Draft ALL 8 required domains: the champion is Critical (8 domains) and
        // conditional approval now requires every required review to be at least
        // drafted (M2.5 completeness gate).
        body: JSON.stringify({
          domains: [
            "legal",
            "procurement",
            "tech-architecture",
            "responsible-ai",
            "security",
            "privacy-hipaa",
            "clinical-safety",
            "data-governance",
          ],
        }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(draftRunRes.status).toBe(200);
    const draftRunJson = await draftRunRes.json();
    expect(draftRunJson.outcomes.filter((o: { status: string }) => o.status === "drafted")).toHaveLength(8);

    const progressRes = await draftRunGet(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run?cycleId=${cycleId}`),
    );
    expect(progressRes.status).toBe(200);
    const progressJson = await progressRes.json();
    expect(progressJson.rows.length).toBeGreaterThan(0);

    const { POST: signPost } = await import("../reviews/[cycleId]/[domain]/sign/route");
    const signRes = await signPost(
      new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/sign`, {
        method: "POST",
        headers: bearer(reviewerToken, "10.0.0.1"),
        body: JSON.stringify({ editedDraftMd: "Reviewer-edited clinical safety draft." }),
      }),
      { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) },
    );
    expect(signRes.status).toBe(200);

    // Non-reviewer (requester) cannot sign — 403.
    const signAsRequesterRes = await signPost(
      new Request(`http://localhost/api/reviews/${cycleId}/legal/sign`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
      }),
      { params: Promise.resolve({ cycleId, domain: "legal" }) },
    );
    expect(signAsRequesterRes.status).toBe(403);

    // elena-vasquez is a REVIEWER but is assigned clinical-safety, not legal —
    // reviewer-domain-assignment authz rejects a same-role, wrong-domain sign with 403.
    const signWrongDomainRes = await signPost(
      new Request(`http://localhost/api/reviews/${cycleId}/legal/sign`, {
        method: "POST",
        headers: bearer(reviewerToken, "10.0.0.1"),
      }),
      { params: Promise.resolve({ cycleId, domain: "legal" }) },
    );
    expect(signWrongDomainRes.status).toBe(403);

    const { POST: decidePost } = await import("../initiatives/[id]/decide/route");
    const decideRes = await decidePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/decide`, {
        method: "POST",
        headers: bearer(approverToken, "10.0.0.1"),
        body: JSON.stringify({
          decision: "conditionally_approved",
          conditions: [{ text: "100% human review for 90 days.", controlId: "C-01" }],
        }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(decideRes.status).toBe(200);
    const decideJson = await decideRes.json();
    expect(decideJson.type).toBe("conditionally_approved");

    // Requester cannot decide — 403 (SoD).
    const decideAsRequesterRes = await decidePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/decide`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(decideAsRequesterRes.status).toBe(403);
  });
});

describe("requester ownership authz on submit", () => {
  it("a requester who does not own the initiative gets 403 on submit; owner can still submit after", async () => {
    const ownerToken = await issueSessionFor("priya-raman");
    const otherRequesterToken = await issueSessionFor("dan-kowalski");

    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(ownerToken, "13.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");

    // dan-kowalski is a real requester persona but does not own this initiative.
    const nonOwnerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(otherRequesterToken, "13.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(nonOwnerRes.status).toBe(403);

    // The owning requester can still submit normally.
    const ownerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(ownerToken, "13.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerRes.status).toBe(200);
    const ownerJson = await ownerRes.json();
    expect(ownerJson.submitted).toBe(true);
  });
});

describe("budget-exhaustion 429 on draft-run", () => {
  it("429s when the daily token budget is already exhausted", async () => {
    // Exhaust the shared budget store for "today" directly via the guard's
    // test hook, then confirm the route surfaces 429 rather than invoking
    // the AgentPort.
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    const store = getBudgetStoreForTests();
    const today = new Date().toISOString().slice(0, 10);
    await store.addUsage(today, 10_000_000);

    const requesterToken = await issueSessionFor("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, "11.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(requesterToken, "11.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(requesterToken, "11.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const { POST: draftRunPost } = await import("../initiatives/[id]/draft-run/route");
    const res = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: bearer(requesterToken, "11.0.0.1"),
        body: JSON.stringify({ domains: ["legal"] }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(429);
  });
});

describe("POST /api/reviews/[cycleId]/[domain]/run — on-demand agent run", () => {
  async function setUpCycle(ip: string): Promise<{ initiativeId: string; cycleId: string }> {
    const requesterToken = await issueSessionFor("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, ip),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(requesterToken, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const triageRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(requesterToken, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { cycleId } = await triageRes.json();
    return { initiativeId, cycleId };
  }

  it("401s an unauthenticated run with no side effects", async () => {
    const { cycleId } = await setUpCycle("20.0.0.1");
    const { POST: runPost } = await import("../reviews/[cycleId]/[domain]/run/route");
    const res = await runPost(
      new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "20.0.0.9" },
      }),
      { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) },
    );
    expect(res.status).toBe(401);
  });

  it("200s and drafts when the assigned reviewer runs their own domain", async () => {
    const { cycleId } = await setUpCycle("21.0.0.1");
    const reviewerToken = await issueSessionFor("elena-vasquez"); // clinical-safety
    const { POST: runPost } = await import("../reviews/[cycleId]/[domain]/run/route");
    const res = await runPost(
      new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/run`, {
        method: "POST",
        headers: bearer(reviewerToken, "21.0.0.2"),
      }),
      { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("drafted");
    expect(json.draftMd).toBeTruthy();
  });

  it("403s when a reviewer runs a domain they are not assigned to", async () => {
    const { cycleId } = await setUpCycle("22.0.0.1");
    const reviewerToken = await issueSessionFor("elena-vasquez"); // clinical-safety, NOT privacy-hipaa
    const { POST: runPost } = await import("../reviews/[cycleId]/[domain]/run/route");
    const res = await runPost(
      new Request(`http://localhost/api/reviews/${cycleId}/privacy-hipaa/run`, {
        method: "POST",
        headers: bearer(reviewerToken, "22.0.0.2"),
      }),
      { params: Promise.resolve({ cycleId, domain: "privacy-hipaa" }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/agents/health — connector probe", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("401s an unauthenticated probe (session-gated, no key burn for the public)", async () => {
    const { POST } = await import("../agents/health/route");
    const res = await POST(
      new Request("http://localhost/api/agents/health", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "30.0.0.1" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("200s with a session and reports the mock adapter when no key is configured (no network call)", async () => {
    delete process.env.OPENAI_API_KEY;
    const token = await issueSessionFor("sofia-grant");
    const { POST } = await import("../agents/health/route");
    const res = await POST(
      new Request("http://localhost/api/agents/health", {
        method: "POST",
        headers: bearer(token, "30.0.0.2"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(false);
    expect(json.adapter).toBe("mock");
  });
});

describe("GET routes stay public read-only", () => {
  it("GET draft-run progress requires no session", async () => {
    const requesterToken = await issueSessionFor("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, "12.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(requesterToken, "12.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const triageRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(requesterToken, "12.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { cycleId } = await triageRes.json();

    const { GET } = await import("../initiatives/[id]/draft-run/route");
    // No Authorization header at all — GET must still succeed (public read-only).
    const res = await GET(new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run?cycleId=${cycleId}`));
    expect(res.status).toBe(200);
  });
});
