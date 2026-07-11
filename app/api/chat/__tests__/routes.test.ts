/**
 * HTTP-layer tests for app/api/chat/** (M2 — plan.md §13 Breadth): the two
 * conversational chat routes, POST /api/chat/auditor and POST
 * /api/chat/intake. Mirrors app/api/admin/__tests__/routes.test.ts's and
 * app/api/__tests__/routes.test.ts's conventions for issuing a session,
 * exhausting the rate limiter/budget, and asserting on JSON error shapes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  // Force the mock AgentPort (deterministic, offline) regardless of any
  // OPENAI_API_KEY present in the ambient test environment.
  delete process.env.OPENAI_API_KEY;
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

const EMPTY_INTAKE_PAYLOAD = {
  basics: { title: "", sponsorOrg: "", requesterName: "", requesterEmail: "", businessProblem: "" },
  useCase: { primaryUsers: "", decisionInformed: "", expectedVolume: null },
  data: {
    dataSources: [],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: null,
  },
  modelVendor: { buildOrBuy: null, vendorName: null, hosting: null, modelType: null },
  populationImpact: { affectedPopulations: [], expectedBenefits: null, expectedHarms: null },
  deployment: { integrationPoints: [], rolloutPlan: null },
  overlay: {
    touchesPHI: null,
    memberFacing: null,
    careCoverageInfluence: null,
    vendorHosted: null,
    humanInTheLoop: null,
    individualImpact: null,
  },
  evidenceAttachments: [],
};

describe("POST /api/chat/auditor", () => {
  it("401s an unauthenticated request", async () => {
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "40.0.0.1" },
        body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400s a malformed body (missing question)", async () => {
    const token = await issueSessionFor("priya-raman", "40.0.0.2");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.0.0.2"),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("200s for any persona (not role-restricted) and grounds on member-facing-phi for a member-facing/PHI question", async () => {
    const token = await issueSessionFor("elena-vasquez", "40.0.0.3");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.0.0.3"),
        body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryUsed).toBe("member-facing-phi");
    expect(Array.isArray(json.rows)).toBe(true);
    expect(json.rows.some((r: { slug: string }) => r.slug === "member-chat-copilot")).toBe(true);
    expect(typeof json.answerMd).toBe("string");
    expect(Array.isArray(json.citedEvents)).toBe(true);
  });

  it("grounds on approved-by-torres for a Torres-approval question", async () => {
    const token = await issueSessionFor("angela-torres", "40.0.0.4");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.0.0.4"),
        body: JSON.stringify({ question: "What has Angela Torres approved by Torres recently?" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryUsed).toBe("approved-by-torres");
  });

  it("grounds on overdue-controls for an overdue-controls question", async () => {
    const token = await issueSessionFor("marcus-webb", "40.0.0.5");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.0.0.5"),
        body: JSON.stringify({ question: "Which controls are overdue right now?" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryUsed).toBe("overdue-controls");
  });

  it("400s a question longer than the input-size cap", async () => {
    const token = await issueSessionFor("priya-raman", "40.0.0.6");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.0.0.6"),
        body: JSON.stringify({ question: "x".repeat(3000) }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("429s after a rate-limit burst from the same client", async () => {
    const token = await issueSessionFor("priya-raman", "40.0.0.7");
    const { POST } = await import("../auditor/route");
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) {
      last = await POST(
        new Request("http://localhost/api/chat/auditor", {
          method: "POST",
          headers: bearer(token, "40.0.0.7"),
          body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
        }),
      );
    }
    expect(last!.status).toBe(429);
  });

});

describe("POST /api/chat/intake", () => {
  it("401s an unauthenticated request", async () => {
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "41.0.0.1" },
        body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403s a non-requester persona (reviewer)", async () => {
    const token = await issueSessionFor("elena-vasquez", "41.0.0.2");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.2"),
        body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("400s a malformed body (partialPayload missing)", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.3");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.3"),
        body: JSON.stringify({ conversation: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("200s for the requester persona and asks the first overlay question when overlay is entirely unanswered", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.4");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.4"),
        body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toContain("Does it access PHI?");
    expect(json.done).toBe(false);
    expect(json.gaps.some((g: { ruleId: string }) => g.ruleId === "BLK-05")).toBe(true);
  });

  it("merges a yes answer into overlay.touchesPHI and recomputes authoritative gaps via evaluateCompleteness", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.5");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.5"),
        body: JSON.stringify({
          conversation: [{ role: "user", content: "Yes, it does access PHI." }],
          partialPayload: EMPTY_INTAKE_PAYLOAD,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updatedPayload.overlay.touchesPHI).toBe(true);
    // BLK-05 (touchesPHI) should no longer be a gap; other BLOCKING rules
    // (e.g. BLK-01 title) still are, since nothing else was answered.
    expect(json.gaps.some((g: { ruleId: string }) => g.ruleId === "BLK-05")).toBe(false);
    expect(json.gaps.some((g: { ruleId: string }) => g.ruleId === "BLK-01")).toBe(true);
    expect(json.done).toBe(false);
  });

  it("400s a conversation entry longer than the per-message cap", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.6");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.6"),
        body: JSON.stringify({
          conversation: [{ role: "user", content: "x".repeat(5000) }],
          partialPayload: EMPTY_INTAKE_PAYLOAD,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("429s after a rate-limit burst from the same client", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.7");
    const { POST } = await import("../intake/route");
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) {
      last = await POST(
        new Request("http://localhost/api/chat/intake", {
          method: "POST",
          headers: bearer(token, "41.0.0.7"),
          body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
        }),
      );
    }
    expect(last!.status).toBe(429);
  });
});

/**
 * Budget-exhaustion tests placed in their own describe block at the end of
 * the file (mirroring app/api/__tests__/routes.test.ts's placement): the
 * shared budget store (lib/services/route-guard.ts's module-scoped
 * `budgetStore`) is a process-wide singleton NOT cleared by
 * `resetGuardStateForTests()`, so exhausting "today"'s budget here must run
 * after every other test in this file that needs budget available.
 */
describe("budget-exhaustion 429 on chat routes", () => {
  it("429s POST /api/chat/auditor when the daily token budget is already exhausted", async () => {
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    const store = getBudgetStoreForTests();
    const today = new Date().toISOString().slice(0, 10);
    await store.addUsage(today, 10_000_000);

    const token = await issueSessionFor("priya-raman", "42.0.0.1");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "42.0.0.1"),
        body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("429s POST /api/chat/intake when the daily token budget is already exhausted", async () => {
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    const store = getBudgetStoreForTests();
    const today = new Date().toISOString().slice(0, 10);
    await store.addUsage(today, 10_000_000);

    const token = await issueSessionFor("priya-raman", "42.0.0.2");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "42.0.0.2"),
        body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(429);
  });
});
