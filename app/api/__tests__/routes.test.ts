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
import { controlDefinitions, initiatives, reviewDecisions, auditEvents, reviewCycles } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createMockAgentPort } from "@/lib/agents/mock-adapter";
import { CONTROL_SEEDS } from "@/scripts/seed";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as agentsModule from "@/lib/agents";
import { AgentInitializationError } from "@/lib/agents/initialization-error";

let testDb: TestDb;
const portMocks = vi.hoisted(() => ({ getAgentPort: vi.fn() }));
vi.mock("@/lib/agents", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/agents")>(),
  getAgentPort: portMocks.getAgentPort,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  testDb = await createTestDb();
  resetGuardStateForTests();
  portMocks.getAgentPort.mockReset().mockReturnValue(createMockAgentPort());
  vi.stubEnv("JEEVES_AGENT_RUNTIME", "ai-sdk");
  vi.stubEnv("JEEVES_DEEP_REVIEW", "0");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeTestDb(testDb);
});

function bearer(token: string, ip = "1.1.1.1"): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

async function reservedTokens(): Promise<number> {
  const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
  return getBudgetStoreForTests().getUsed(new Date().toISOString().slice(0, 10));
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

/**
 * Same-browser login helper (workspace-authorization hardening pass):
 * `issueSessionFor` above issues a session with NO `jeeves_workspace`
 * cookie forwarded, so each call gets its own fresh (session-token-derived)
 * workspace — fine for single-persona tests, but the champion demo flow
 * spans requester -> reviewer -> approver logins IN ONE BROWSER, which a
 * real browser keeps coherent by re-sending the `Set-Cookie` POST
 * /api/session returned on the first login. This helper does that
 * explicitly: pass the previous call's `workspaceCookie` in to keep every
 * persona in this "browser" bound to the SAME session workspace, so
 * workspace-authorization checks (lib/services/workspace-guard.ts) on
 * mutations one persona makes against another persona's live-created rows
 * pass exactly as they would for a real user clicking through the demo.
 */
async function issueSessionInWorkspace(
  personaKey: string,
  workspaceCookie?: string,
): Promise<{ token: string; workspaceCookie: string }> {
  const { POST } = await import("../session/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
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

/**
 * Seed just the control catalog (no full 12-initiative dataset — this file's
 * tests build their own initiatives via the live routes). Needed only by the
 * champion route-chain test below, which now exercises decide()'s
 * post-decision control generation (external-review finding #4) through to
 * a non-empty `controlsGenerated.created` count — mirrors the identically-
 * named helper in lib/services/initiative-service.test.ts.
 */
async function seedControlCatalog(db: TestDb): Promise<void> {
  for (const c of CONTROL_SEEDS) {
    await db.insert(controlDefinitions).values({
      id: c.id,
      domain: c.domain,
      name: c.name,
      applicability: c.applicability,
      policySource: c.policySource,
      owner: c.owner,
      requiredEvidence: c.requiredEvidence,
      cadence: c.cadence,
      enforcementMode: c.enforcementMode,
      exceptionProcess: c.exceptionProcess,
      remediationOwner: c.remediationOwner,
      observationKind: c.observationKind ?? null,
      tierDefaultThresholds: c.tierDefaultThresholds ?? null,
      sustainedWindow: c.sustainedWindow ?? null,
    });
  }
}

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
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0001" }),
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
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0002" }),
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
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, role: "requester", requestId: "routes-create-key-0003" }),
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
          body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: `routes-rate-limit-${i}`.padEnd(16, "0") }),
        }),
      );
    }
    expect(last!.status).toBe(429);
  });
});

describe("full champion route chain: submit -> triage -> draft-run -> sign -> decide", () => {
  it("walks the champion storyline end-to-end via HTTP handlers", async () => {
    // The control catalog isn't part of this file's per-test fixtures (each
    // test builds its own initiatives live) — seed it here so decide()'s
    // post-decision control generation below has definitions to match.
    await seedControlCatalog(testDb);

    // Same-browser logins (issueSessionInWorkspace): the champion demo flow
    // spans requester -> reviewer -> approver logins in ONE browser, which
    // shares one session workspace via the jeeves_workspace cookie — needed
    // now that sign/decide enforce workspace authorization (lib/services/
    // workspace-guard.ts) on the initiative the requester creates below.
    const { token: requesterToken, workspaceCookie } = await issueSessionInWorkspace("priya-raman");
    const { token: reviewerToken } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    const { token: approverToken } = await issueSessionInWorkspace("angela-torres", workspaceCookie);

    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0004" }),
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
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run?cycleId=${cycleId}`, {
        // Read isolation (external-review finding #2): this GET is public/
        // unauthenticated by design, but a live browser's poll still sends
        // its `jeeves_workspace` cookie same-origin — an anonymous request
        // (no cookie at all, as this call used to be) now correctly gets
        // back an empty `rows: []` for a workspace-tagged cycle, same as an
        // unknown one (no existence leak). Forward the same-browser cookie
        // this test already carries for every other call in this flow.
        headers: workspaceCookie ? { cookie: workspaceCookie } : undefined,
      }),
    );
    expect(progressRes.status).toBe(200);
    const progressJson = await progressRes.json();
    expect(progressJson.rows.length).toBeGreaterThan(0);

    const { POST: signPost } = await import("../reviews/[cycleId]/[domain]/sign/route");
    const displayedReviews = await testDb.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
    const clinicalRevision = displayedReviews.find((review) => review.domain === "clinical-safety")!.revision;
    const legalRevision = displayedReviews.find((review) => review.domain === "legal")!.revision;
    const signRes = await signPost(
      new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/sign`, {
        method: "POST",
        headers: bearer(reviewerToken, "10.0.0.1"),
        body: JSON.stringify({ expectedRevision: clinicalRevision, expectedEvidencePacketId: null, editedDraftMd: "Reviewer-edited clinical safety draft." }),
      }),
      { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) },
    );
    expect(signRes.status).toBe(200);

    // Non-reviewer (requester) cannot sign — 403.
    const signAsRequesterRes = await signPost(
      new Request(`http://localhost/api/reviews/${cycleId}/legal/sign`, {
        method: "POST",
        headers: bearer(requesterToken, "10.0.0.1"),
        body: JSON.stringify({ expectedRevision: legalRevision, expectedEvidencePacketId: null }),
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
        body: JSON.stringify({ expectedRevision: legalRevision, expectedEvidencePacketId: null }),
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

    // External-review finding #4 ("live champion workflow stops before
    // control generation"): the decide response itself now confirms the
    // deployment/effective-controls were generated — via the API surface,
    // not a direct DB peek.
    expect(decideJson.controlsGenerated).toBeTruthy();
    expect(decideJson.controlsGenerated.deploymentId).toBeTruthy();
    expect(decideJson.controlsGenerated.created).toBeGreaterThan(0);

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
    // Same-browser logins (issueSessionInWorkspace): submitIntake() now ALSO
    // enforces workspace authorization (external-review finding P2-4), so
    // both requesters must share the SAME session workspace here for this
    // test to isolate the OWNERSHIP check (403) from the workspace check
    // (404) — a cross-workspace, non-owning requester would 404 first (see
    // "workspace isolation on submit/triage routes" below), which is a
    // different, already-covered scenario.
    const owner = await issueSessionInWorkspace("priya-raman");
    const otherRequester = await issueSessionInWorkspace(
      "dan-kowalski",
      owner.workspaceCookie,
    );

    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(owner.token, "13.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0005" }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");

    // dan-kowalski is a real requester persona but does not own this initiative.
    const nonOwnerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(otherRequester.token, "13.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(nonOwnerRes.status).toBe(403);

    // The owning requester can still submit normally.
    const ownerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(owner.token, "13.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerRes.status).toBe(200);
    const ownerJson = await ownerRes.json();
    expect(ownerJson.submitted).toBe(true);
  });
});

describe("deep-review budget multiplier on draft-run", () => {
  // The actual Agents SDK runtime plus deep-review flag selects 15,000
  // estimated tokens per attempt. The agent port is always mocked here.
  const DAILY_TOKEN_CAP = 500_000;
  const STANDARD_RESERVE = 8 * 1500; // 8 domains x ESTIMATED_TOKENS_PER_DOMAIN
  const ALL_DOMAINS = [
    "legal",
    "procurement",
    "tech-architecture",
    "responsible-ai",
    "security",
    "privacy-hipaa",
    "clinical-safety",
    "data-governance",
  ];

  async function triagedInitiative(ip: string): Promise<{ id: string; token: string }> {
    const token = await issueSessionFor("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, ip),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: `routes-helper-${ip.replaceAll(".", "-")}` }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    return { id: initiativeId, token };
  }

  /** Leaves `headroom` tokens of the daily cap unspent. */
  async function leaveHeadroom(headroom: number): Promise<void> {
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    const store = getBudgetStoreForTests();
    const today = new Date().toISOString().slice(0, 10);
    const used = await store.getUsed(today);
    await store.addUsage(today, DAILY_TOKEN_CAP - headroom - used);
  }

  async function draftRun(id: string, token: string, ip: string): Promise<number> {
    const { POST: draftRunPost } = await import("../initiatives/[id]/draft-run/route");
    const res = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${id}/draft-run`, {
        method: "POST",
        headers: bearer(token, ip),
        body: JSON.stringify({ domains: ALL_DOMAINS }),
      }),
      { params: Promise.resolve({ id }) },
    );
    return res.status;
  }

  it("reserves the standard estimate when deep review is off", async () => {
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "0");
    await leaveHeadroom(STANDARD_RESERVE);
    const { id, token } = await triagedInitiative("11.5.0.1");
    expect(await draftRun(id, token, "11.5.0.1")).not.toBe(429);
  });

  it("returns a safe 503 for missing agent assets while keeping unknown IDs private", async () => {
    const { id, token } = await triagedInitiative("11.7.0.1");
    const { POST } = await import("../initiatives/[id]/draft-run/route");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(tmpdir(), "jeeves-missing-prompts-")));
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder-never-sent");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in asset regression"));
    try {
      const request = () => new Request("http://localhost/api/initiatives/test/draft-run", {
        method: "POST", headers: bearer(token, "11.7.0.1"), body: JSON.stringify({ domains: ["legal"] }),
      });
      const response = await POST(request(), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Agent runtime could not initialize. Check the deployed prompts and policies.", code: "AGENT_INITIALIZATION_FAILED" });
      const missing = await POST(request(), { params: Promise.resolve({ id: "unknown" }) });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "initiative or review cycle not found" });
    } finally {
      cwd.mockRestore();
      fetch.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("429s with the same request when JEEVES_DEEP_REVIEW=1 — the 10x reserve no longer fits", async () => {
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    // 12,000 fits eight ordinary attempts, but cannot fund one deep attempt.
    await leaveHeadroom(STANDARD_RESERVE);
    const { id, token } = await triagedInitiative("11.6.0.1");
    expect(await draftRun(id, token, "11.6.0.1")).toBe(429);
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
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0006" }),
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
  async function setUpCycle(
    ip: string,
  ): Promise<{ initiativeId: string; cycleId: string; workspaceCookie: string }> {
    const { token: requesterToken, workspaceCookie } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, ip),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0007" }),
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
    return { initiativeId, cycleId, workspaceCookie };
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
    expect(await reservedTokens()).toBe(0);
    expect(portMocks.getAgentPort).not.toHaveBeenCalled();
  });

  it("200s and drafts when the assigned reviewer runs their own domain", async () => {
    const { cycleId, workspaceCookie } = await setUpCycle("21.0.0.1");
    // Same-browser login (see issueSessionInWorkspace) so the reviewer's
    // session shares the requester's live-created workspace.
    const { token: reviewerToken } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie); // clinical-safety
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

  it("returns a safe 503 when an authorized reviewer's agent cannot initialize", async () => {
    const { cycleId, workspaceCookie } = await setUpCycle("21.8.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    const { POST } = await import("../reviews/[cycleId]/[domain]/run/route");
    const factory = vi.spyOn(agentsModule, "getAgentPort").mockImplementationOnce(() => {
      throw new AgentInitializationError(new Error("ENOENT /private/build/prompts"));
    });
    try {
      const response = await POST(new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/run`, {
        method: "POST", headers: bearer(token, "21.8.0.2"),
      }), { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Agent runtime could not initialize. Check the deployed prompts and policies.", code: "AGENT_INITIALIZATION_FAILED" });
    } finally {
      factory.mockRestore();
    }
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
    expect(await reservedTokens()).toBe(0);
    expect(portMocks.getAgentPort).not.toHaveBeenCalled();
  });

  async function runDomain(cycleId: string, token: string, expectedRevision?: number) {
    const { POST } = await import("../reviews/[cycleId]/[domain]/run/route");
    return POST(new Request(`http://localhost/api/reviews/${cycleId}/clinical-safety/run`, {
      method: "POST", headers: bearer(token, "23.0.0.2"),
      body: JSON.stringify(expectedRevision === undefined ? {} : { expectedRevision }),
    }), { params: Promise.resolve({ cycleId, domain: "clinical-safety" }) });
  }

  it("uses the same 15,000-token deep runtime reservation for a reviewer", async () => {
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    const { cycleId, workspaceCookie } = await setUpCycle("23.0.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    const response = await runDomain(cycleId, token, 0);
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("drafted");
    expect(await reservedTokens()).toBe(15_000);
    const receipts = await testDb.select().from(auditEvents).where(eq(auditEvents.action, "draft_budget_reserved"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].metadata).toMatchObject({ estimatedTokens: 15_000, attempt: 1 });
    expect(portMocks.getAgentPort).toHaveBeenCalledTimes(1);
  });

  it("does not enable deep budgeting for the AI SDK runtime alone", async () => {
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "ai-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    const { cycleId, workspaceCookie } = await setUpCycle("23.1.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    expect((await runDomain(cycleId, token)).status).toBe(200);
    expect(await reservedTokens()).toBe(1_500);
  });

  it("does not reserve for foreign workspaces, stale revisions, signed reviews, or an active duplicate", async () => {
    const { cycleId, workspaceCookie } = await setUpCycle("23.2.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    const stranger = await issueSessionFor("elena-vasquez");
    expect((await runDomain(cycleId, stranger)).status).toBe(404);
    expect((await runDomain(cycleId, token, 9)).status).toBe(409);
    await testDb.update(reviewDecisions).set({ status: "signed", draftMd: "Signed review" }).where(and(
      eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety"),
    ));
    expect((await runDomain(cycleId, token)).status).toBe(400);
    await testDb.update(reviewDecisions).set({ status: "pending", activeAttemptId: "active-duplicate", activeAttemptExpiresAt: new Date(Date.now() + 60_000) }).where(and(
      eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety"),
    ));
    const duplicate = await runDomain(cycleId, token);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ status: "skipped", reason: "already running" });
    expect(await reservedTokens()).toBe(0);
    expect(portMocks.getAgentPort).not.toHaveBeenCalled();
  });

  it("returns a budget-specific 429 without invoking the reviewer provider", async () => {
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    const { cycleId, workspaceCookie } = await setUpCycle("23.3.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    await getBudgetStoreForTests().addUsage(new Date().toISOString().slice(0, 10), 499_999);
    const port = createMockAgentPort();
    const draft = vi.spyOn(port, "draftReview");
    portMocks.getAgentPort.mockReturnValue(port);
    const response = await runDomain(cycleId, token);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ status: "failed", errorKind: "budget-exhausted" });
    expect(draft).not.toHaveBeenCalled();
    expect(await reservedTokens()).toBe(499_999);
  });

  it("returns 409 for a closed cycle without reserving capacity", async () => {
    const { cycleId, workspaceCookie } = await setUpCycle("23.4.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    await testDb.update(reviewCycles).set({ closedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    expect((await runDomain(cycleId, token)).status).toBe(409);
    expect(await reservedTokens()).toBe(0);
  });

  it("returns a sanitized 500 and rolls back a draft when the audit receipt fails", async () => {
    const { cycleId, workspaceCookie } = await setUpCycle("23.5.0.1");
    const { token } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);
    await testDb.execute(sql`CREATE FUNCTION reject_route_receipt() RETURNS trigger AS $$ BEGIN
      IF NEW.action='review_agent_run' THEN RAISE EXCEPTION 'private database receipt failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await testDb.execute(sql`CREATE TRIGGER reject_route_receipt BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_route_receipt()`);
    const response = await runDomain(cycleId, token);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ requestId: expect.any(String), error: expect.stringMatching(/Refresh/) });
    expect(JSON.stringify(body)).not.toContain("private database");
    const [row] = await testDb.select().from(reviewDecisions).where(and(
      eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, "clinical-safety"),
    ));
    expect(row).toMatchObject({ status: "pending", revision: 0, draftMd: null });
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
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0008" }),
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

/* ---------------------------------------------------------------------------
 * Security-hardening pass — external-review finding #1: workspace isolation
 * is not an authorization boundary on mutations. End-to-end route coverage
 * for the decide route (per-service coverage lives in
 * lib/services/initiative-service.test.ts).
 * ------------------------------------------------------------------------ */
describe("workspace isolation on mutation routes (external-review finding #1)", () => {
  it("decide route: a stranger's session (different browser) gets 404; the owning browser's session gets 200", async () => {
    const { token: requesterToken, workspaceCookie } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(requesterToken, "50.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0009" }),
      }),
    );
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(requesterToken, "50.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(requesterToken, "50.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const { POST: decidePost } = await import("../initiatives/[id]/decide/route");

    // A different browser — no shared jeeves_workspace cookie — gets its own
    // fresh workspace and cannot see/decide this live-created initiative.
    const { token: strangerToken } = await issueSessionInWorkspace("angela-torres");
    const strangerRes = await decidePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/decide`, {
        method: "POST",
        headers: bearer(strangerToken, "50.0.0.2"),
        body: JSON.stringify({ decision: "rejected" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(strangerRes.status).toBe(404);

    // The SAME browser (shared workspace cookie) succeeds normally.
    const { token: approverToken } = await issueSessionInWorkspace("angela-torres", workspaceCookie);
    const ownerRes = await decidePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/decide`, {
        method: "POST",
        headers: bearer(approverToken, "50.0.0.3"),
        body: JSON.stringify({ decision: "rejected" }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerRes.status).toBe(200);
    expect((await ownerRes.json()).type).toBe("rejected");
  });
});

/* ---------------------------------------------------------------------------
 * Security-hardening pass — external-review finding P2-4: submitIntake()/
 * triage() never received the session workspace, unlike decide() above.
 * Route-level coverage (per-service coverage lives in
 * lib/services/initiative-service.test.ts).
 * ------------------------------------------------------------------------ */
describe("workspace isolation on submit/triage routes (external-review finding P2-4)", () => {
  it("submit route: a stranger's session gets 404; the owning session gets 200", async () => {
    const { token: ownerToken } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(ownerToken, "52.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0011" }),
      }),
    );
    const { initiativeId } = await createRes.json();

    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");

    // A different browser — no shared jeeves_workspace cookie — gets its own
    // fresh workspace and cannot see/submit this live-created initiative.
    // dan-kowalski is also not the owning requester, but the workspace check
    // must 404 before requester-ownership is ever evaluated.
    const { token: strangerToken } = await issueSessionInWorkspace("dan-kowalski");
    const strangerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(strangerToken, "52.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(strangerRes.status).toBe(404);

    const ownerRes = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(ownerToken, "52.0.0.3"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerRes.status).toBe(200);
    expect((await ownerRes.json()).submitted).toBe(true);
  });

  it("triage route: a stranger's session gets 404; the owning session gets 200", async () => {
    const { token: ownerToken } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(ownerToken, "53.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0012" }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(ownerToken, "53.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const { token: strangerToken } = await issueSessionInWorkspace("angela-torres");
    const strangerRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(strangerToken, "53.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(strangerRes.status).toBe(404);

    const ownerRes = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(ownerToken, "53.0.0.3"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(ownerRes.status).toBe(200);
    expect((await ownerRes.json()).tier).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------------
 * Security-hardening pass — external-review finding P2-5a: updateInitiativeState()
 * was a plain `where(eq(id))` update, allowing concurrent submitIntake()/
 * triage() calls to duplicate work. Route-level mapping to 409 (per-service
 * CAS coverage lives in lib/services/initiative-service.test.ts).
 * ------------------------------------------------------------------------ */
describe("409 conflict mapping on submit/triage routes (external-review finding P2-5a)", () => {
  /** Injects a same-transaction concurrent write on the `initiatives` table's
   * FIRST update, reproducing the DB-visible effect of a genuinely concurrent
   * committed write landing between the route's read and its CAS update —
   * same technique as the service-layer CAS tests. */
  function injectConcurrentInitiativeWrite(initiativeId: string, injectedState: string): () => void {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const dbAny = testDb as any;
    const realTransaction = dbAny.transaction.bind(dbAny);
    const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
      realTransaction(async (tx: any) => {
        const realUpdate = tx.update.bind(tx);
        let injected = false;
        vi.spyOn(tx, "update").mockImplementation((table: any) => {
          const builder = realUpdate(table);
          if (table === initiatives && !injected) {
            injected = true;
            const realSet = builder.set.bind(builder);
            builder.set = (values: Record<string, unknown>) => {
              const base = realSet(values);
              const realWhere = base.where.bind(base);
              base.where = (cond: unknown) => {
                const afterWhere = realWhere(cond);
                const realReturning = afterWhere.returning.bind(afterWhere);
                afterWhere.returning = async (...args: unknown[]) => {
                  await realUpdate(initiatives).set({ state: injectedState }).where(eq(initiatives.id, initiativeId));
                  return realReturning(...args);
                };
                return afterWhere;
              };
              return base;
            };
          }
          return builder;
        });
        return cb(tx);
      }),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return () => spy.mockRestore();
  }

  it("submit route maps ConflictError to 409", async () => {
    const { token } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, "54.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0013" }),
      }),
    );
    const { initiativeId } = await createRes.json();

    const restore = injectConcurrentInitiativeWrite(initiativeId, "triaged");
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    const res = await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(token, "54.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(409);
    restore();
  });

  it("triage route maps ConflictError to 409", async () => {
    const { token } = await issueSessionInWorkspace("priya-raman");
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, "55.0.0.1"),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0014" }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(token, "55.0.0.1"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );

    const restore = injectConcurrentInitiativeWrite(initiativeId, "triaged");
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    const res = await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(token, "55.0.0.2"),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(409);
    restore();
  });
});

/* ---------------------------------------------------------------------------
 * Security-hardening pass — external-review finding #6 (partial): draft-run
 * had weak authorization (any authenticated persona could trigger it).
 * ------------------------------------------------------------------------ */
describe("POST /api/initiatives/[id]/draft-run — role + workspace authorization", () => {
  async function createSubmittedTriagedInitiative(
    token: string,
    ip: string,
  ): Promise<string> {
    const { POST: createInitiative } = await import("../initiatives/route");
    const createRes = await createInitiative(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: bearer(token, ip),
        body: JSON.stringify({ payload: CHAMPION_PAYLOAD, requestId: "routes-create-key-0010" }),
      }),
    );
    const { initiativeId } = await createRes.json();
    const { POST: submitPost } = await import("../initiatives/[id]/submit/route");
    await submitPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    const { POST: triagePost } = await import("../initiatives/[id]/triage/route");
    await triagePost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/triage`, {
        method: "POST",
        headers: bearer(token, ip),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    return initiativeId;
  }

  it("403s a reviewer session (not in the allowed role set)", async () => {
    const { token: requesterToken, workspaceCookie } = await issueSessionInWorkspace("priya-raman");
    const initiativeId = await createSubmittedTriagedInitiative(requesterToken, "51.0.0.1");
    const { token: reviewerToken } = await issueSessionInWorkspace("elena-vasquez", workspaceCookie);

    const { POST: draftRunPost } = await import("../initiatives/[id]/draft-run/route");
    const res = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: bearer(reviewerToken, "51.0.0.2"),
        body: JSON.stringify({ domains: ["legal"] }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(403);
    expect(await reservedTokens()).toBe(0);
    expect(portMocks.getAgentPort).not.toHaveBeenCalled();
  });

  it("200s an admin session (in the allowed role set) in the owning workspace", async () => {
    const { token: requesterToken, workspaceCookie } = await issueSessionInWorkspace("priya-raman");
    const initiativeId = await createSubmittedTriagedInitiative(requesterToken, "51.0.1.1");
    const { token: adminToken } = await issueSessionInWorkspace("ray-chen", workspaceCookie);

    const { POST: draftRunPost } = await import("../initiatives/[id]/draft-run/route");
    const res = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: bearer(adminToken, "51.0.1.2"),
        body: JSON.stringify({ domains: ["legal"] }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(200);
  });

  it("404s a requester session from a DIFFERENT workspace than the one that created the initiative", async () => {
    const { token: requesterToken } = await issueSessionInWorkspace("priya-raman");
    const initiativeId = await createSubmittedTriagedInitiative(requesterToken, "51.0.2.1");

    // A different browser — fresh workspace, no relation to the initiative above.
    const { token: strangerToken } = await issueSessionInWorkspace("dan-kowalski");
    const { POST: draftRunPost } = await import("../initiatives/[id]/draft-run/route");
    const res = await draftRunPost(
      new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
        method: "POST",
        headers: bearer(strangerToken, "51.0.2.2"),
        body: JSON.stringify({ domains: ["legal"] }),
      }),
      { params: Promise.resolve({ id: initiativeId }) },
    );
    expect(res.status).toBe(404);
    expect(await reservedTokens()).toBe(0);
    expect(portMocks.getAgentPort).not.toHaveBeenCalled();
  });

  it("does not reserve again for repeated or duplicate domains and signed no-ops", async () => {
    const { token } = await issueSessionInWorkspace("priya-raman");
    const initiativeId = await createSubmittedTriagedInitiative(token, "51.0.3.1");
    const { POST } = await import("../initiatives/[id]/draft-run/route");
    const run = () => POST(new Request(`http://localhost/api/initiatives/${initiativeId}/draft-run`, {
      method: "POST", headers: bearer(token, "51.0.3.2"), body: JSON.stringify({ domains: ["legal", "legal"] }),
    }), { params: Promise.resolve({ id: initiativeId }) });
    const first = await run();
    expect(first.status).toBe(200);
    expect((await first.json()).outcomes).toHaveLength(1);
    expect(await reservedTokens()).toBe(1_500);
    const repeated = await run();
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).outcomes).toEqual([{ domain: "legal", status: "skipped" }]);
    const [cycle] = await testDb.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, initiativeId));
    await testDb.update(reviewDecisions).set({ status: "signed" }).where(and(
      eq(reviewDecisions.cycleId, cycle.id), eq(reviewDecisions.domain, "legal"),
    ));
    const signed = await run();
    expect(signed.status).toBe(200);
    expect((await signed.json()).outcomes).toEqual([{ domain: "legal", status: "skipped", reason: "already signed" }]);
    expect(await reservedTokens()).toBe(1_500);
    expect(portMocks.getAgentPort).toHaveBeenCalledTimes(1);
  });

});

/* ---------------------------------------------------------------------------
 * Security-hardening pass — signed jeeves_workspace cookie
 * (lib/security/workspace-cookie.ts). issueDemoSession used to trust the raw
 * incoming cookie unconditionally; POST /api/session now signs it and
 * verifies the signature on the way in. "Missing secret -> never reuse" is
 * covered directly (and more precisely) in lib/security/workspace-cookie.test.ts
 * — it isn't reachable here because these route tests need DEMO_PASSCODE set
 * for the passcode check itself, and a set DEMO_PASSCODE always yields a
 * derivable fallback secret.
 * ------------------------------------------------------------------------ */
describe("POST /api/session — signed workspace cookie", () => {
  function extractCookie(res: Response): string {
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const match = setCookie!.match(/jeeves_workspace=([^;]+)/);
    expect(match).toBeTruthy();
    return decodeURIComponent(match![1]!);
  }

  it("the Set-Cookie value is signed (id.hexmac) and reusing it keeps the SAME workspaceId across logins", async () => {
    const { POST } = await import("../session/route");
    const res1 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "priya-raman" }),
      }),
    );
    const json1 = (await res1.json()) as { workspaceId: string };
    const cookieValue = extractCookie(res1);
    expect(cookieValue).toMatch(/^ws_[0-9a-f]+\.[0-9a-f]{64}$/);
    expect(cookieValue.startsWith(`${json1.workspaceId}.`)).toBe(true);

    const res2 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `jeeves_workspace=${cookieValue}` },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "elena-vasquez" }),
      }),
    );
    const json2 = (await res2.json()) as { workspaceId: string };
    expect(json2.workspaceId).toBe(json1.workspaceId);
  });

  it("an unsigned/legacy cookie value is rejected — issues a fresh workspace, no error", async () => {
    const { POST } = await import("../session/route");
    const res1 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "priya-raman" }),
      }),
    );
    const json1 = (await res1.json()) as { workspaceId: string };

    // Legacy/unsigned: the raw workspaceId with no ".<mac>" suffix.
    const res2 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `jeeves_workspace=${json1.workspaceId}` },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "elena-vasquez" }),
      }),
    );
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { workspaceId: string };
    expect(json2.workspaceId).not.toBe(json1.workspaceId);
  });

  it("a tampered signature is rejected — issues a fresh workspace, no error", async () => {
    const { POST } = await import("../session/route");
    const res1 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "priya-raman" }),
      }),
    );
    const json1 = (await res1.json()) as { workspaceId: string };
    const cookieValue = extractCookie(res1);
    const tampered = cookieValue.slice(0, -1) + (cookieValue.endsWith("0") ? "1" : "0");

    const res2 = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `jeeves_workspace=${tampered}` },
        body: JSON.stringify({ passcode: PASSCODE, personaKey: "marcus-webb" }),
      }),
    );
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { workspaceId: string };
    expect(json2.workspaceId).not.toBe(json1.workspaceId);
  });
});
