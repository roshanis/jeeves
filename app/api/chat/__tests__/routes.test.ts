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
import { seedDatabase } from "@/scripts/seed";
import * as agentsModule from "@/lib/agents";
import { AgentInitializationError } from "@/lib/agents/initialization-error";
import * as dataModule from "@/lib/data";
import { getBudgetStoreForTests } from "@/lib/services/route-guard";
import { createDraft } from "@/lib/services/initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const COOKIE_SECRET = "test-only-workspace-cookie-secret";

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = COOKIE_SECRET;
  // Force the mock AgentPort (deterministic, offline) regardless of any
  // OPENAI_API_KEY present in the ambient test environment.
  delete process.env.OPENAI_API_KEY;
  testDb = await createTestDb();
  await seedDatabase(testDb);
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
      body: JSON.stringify({ personaKey }),
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

describe("agent initialization failures", () => {
  it.each(["intake", "auditor"])("returns a safe 503 from %s chat", async (kind) => {
    const token = await issueSessionFor("priya-raman", "40.8.0.1");
    const route = kind === "intake" ? await import("../intake/route") : await import("../auditor/route");
    const factory = vi.spyOn(agentsModule, "getAgentPort").mockImplementationOnce(() => {
      throw new AgentInitializationError(new Error("ENOENT /private/build/prompts"));
    });
    try {
      const response = await route.POST(new Request(`http://localhost/api/chat/${kind}`, {
        method: "POST", headers: bearer(token, "40.8.0.1"),
        body: JSON.stringify(kind === "intake" ? { conversation: [], partialPayload: {} } : { question: "Which initiatives touch PHI?" }),
      }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Agent runtime could not initialize. Check the deployed prompts and policies.", code: "AGENT_INITIALIZATION_FAILED" });
    } finally {
      factory.mockRestore();
    }
  });
});

describe("chat routes abort and citation handling", () => {
  it("passes the request abort signal to the intake agent call (agents-F6)", async () => {
    const token = await issueSessionFor("priya-raman", "42.0.0.1");
    const { POST } = await import("../intake/route");
    let seen: AbortSignal | undefined;
    const spy = vi.spyOn(agentsModule, "getAgentPort").mockReturnValue({
      intakeInterview: async (_i: unknown, options?: { signal?: AbortSignal }) => {
        seen = options?.signal;
        return { ok: false, error: { kind: "cancelled" } };
      },
    } as unknown as ReturnType<typeof agentsModule.getAgentPort>);
    try {
      const controller = new AbortController();
      const req = new Request("http://localhost/api/chat/intake", {
        method: "POST", headers: bearer(token, "42.0.0.1"), signal: controller.signal,
        body: JSON.stringify({ conversation: [], partialPayload: EMPTY_INTAKE_PAYLOAD }),
      });
      const res = await POST(req);
      expect(seen).toBe(req.signal);
      expect(res.status).toBe(499);
    } finally { spy.mockRestore(); }
  });

  it("passes the request abort signal to the auditor agent call (agents-F6)", async () => {
    const token = await issueSessionFor("priya-raman", "42.0.0.2");
    const { POST } = await import("../auditor/route");
    let seen: AbortSignal | undefined;
    const spy = vi.spyOn(agentsModule, "getAgentPort").mockReturnValue({
      auditorAnswer: async (_i: unknown, options?: { signal?: AbortSignal }) => {
        seen = options?.signal;
        return { ok: false, error: { kind: "cancelled" } };
      },
    } as unknown as ReturnType<typeof agentsModule.getAgentPort>);
    try {
      const controller = new AbortController();
      const req = new Request("http://localhost/api/chat/auditor", {
        method: "POST", headers: bearer(token, "42.0.0.2"), signal: controller.signal,
        body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
      });
      const res = await POST(req);
      expect(seen).toBe(req.signal);
      expect(res.status).toBe(499);
    } finally { spy.mockRestore(); }
  });

  it("drops model-supplied citedEvents that are not in the grounding rows and caps the list (api-initiatives-F29)", async () => {
    const token = await issueSessionFor("priya-raman", "42.0.0.3");
    const { POST } = await import("../auditor/route");
    let grounded: readonly Record<string, unknown>[] = [];
    const spy = vi.spyOn(agentsModule, "getAgentPort").mockImplementation(() => ({
      auditorAnswer: async (input: { groundingRows: readonly Record<string, unknown>[]; queryUsed: string }) => {
        grounded = input.groundingRows;
        const real = grounded.map((r) => r["eventTs"]).find((v): v is string => typeof v === "string");
        return { ok: true, value: {
          answerMd: "answer", queryUsed: input.queryUsed,
          citedEvents: [...(real ? [real] : []), "2099-01-01T00:00:00.000Z", "row-0", "invented-decision-id"],
        } };
      },
    }) as unknown as ReturnType<typeof agentsModule.getAgentPort>);
    try {
      const res = await POST(new Request("http://localhost/api/chat/auditor", {
        method: "POST", headers: bearer(token, "42.0.0.3"),
        body: JSON.stringify({ question: "Which initiatives are member-facing and touch PHI?" }),
      }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.citedEvents).not.toContain("2099-01-01T00:00:00.000Z");
      expect(json.citedEvents).not.toContain("invented-decision-id");
      expect(json.citedEvents).toContain("row-0");
      expect(json.citedEvents.length).toBeLessThanOrEqual(grounded.length + 1);
    } finally { spy.mockRestore(); }
  });

  it("keeps a genuine citation spelled as the same instant and caps the list (api-initiatives-F29)", async () => {
    const token = await issueSessionFor("priya-raman", "42.0.0.4");
    const { POST } = await import("../auditor/route");
    let real = "";
    const spy = vi.spyOn(agentsModule, "getAgentPort").mockImplementation(() => ({
      auditorAnswer: async (input: { groundingRows: readonly Record<string, unknown>[]; queryUsed: string }) => {
        real = input.groundingRows.map((r) => r["eventTs"]).find((v): v is string => typeof v === "string") ?? "";
        const respelled = new Date(real).toISOString().replace(".000Z", "Z");
        const offset = respelled.replace("Z", "+00:00");
        return { ok: true, value: {
          answerMd: "answer", queryUsed: input.queryUsed,
          citedEvents: [real, respelled, offset, "2099-01-01T00:00:00Z", ...Array.from({ length: 80 }, (_, i) => `row-${i}`)],
        } };
      },
    }) as unknown as ReturnType<typeof agentsModule.getAgentPort>);
    try {
      const res = await POST(new Request("http://localhost/api/chat/auditor", {
        method: "POST", headers: bearer(token, "42.0.0.4"),
        body: JSON.stringify({ question: "Which decisions were approved by Torres?" }),
      }));
      const json = await res.json();
      expect(real).not.toBe("");
      expect(json.citedEvents).toContain(real);
      expect(json.citedEvents).toContain(new Date(real).toISOString().replace(".000Z", "Z"));
      expect(json.citedEvents).toContain(new Date(real).toISOString().replace(".000Z", "Z").replace("Z", "+00:00"));
      expect(json.citedEvents).not.toContain("2099-01-01T00:00:00Z");
      expect(json.citedEvents.length).toBeLessThanOrEqual(50);
    } finally { spy.mockRestore(); }
  });
});

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

  it("grounds on the initiative's own events when the question names the documented slug member-chat-copilot (api-initiatives-F16)", async () => {
    const token = await issueSessionFor("angela-torres", "40.1.0.1");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.1.0.1"),
        body: JSON.stringify({ question: "Show the audit history of member-chat-copilot" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).queryUsed).toBe("initiative-events:member-chat-copilot");
  });

  it("resolves a live slug with a hex suffix, and does not substitute the default query for an unknown slug (api-initiatives-F16)", async () => {
    const draft = await createDraft(testDb, {
      payload: CHAMPION_PREFILL_PAYLOAD,
      requesterActor: { id: "priya-raman", role: "requester" },
      requesterName: "Priya Raman",
      workspaceId: null,
    });
    const { initiatives } = await import("@/lib/db/schema");
    const slug = (await testDb.select().from(initiatives)).find((i) => i.id === draft.initiativeId)!.slug;
    expect(slug).toMatch(/-[0-9a-f]{8}$/);
    const token = await issueSessionFor("angela-torres", "40.1.0.2");
    const { POST } = await import("../auditor/route");
    const ask = async (question: string) =>
      (await POST(
        new Request("http://localhost/api/chat/auditor", {
          method: "POST",
          headers: bearer(token, "40.1.0.2"),
          body: JSON.stringify({ question }),
        }),
      )).json();
    expect((await ask(`Show the history of ${slug}`)).queryUsed).toBe(`initiative-events:${slug}`);
    const unknown = await ask("Show the history of no-such-initiative-0123abcd");
    expect(unknown.queryUsed).toMatch(/^initiative-not-found:/);
    expect(unknown.rows).toEqual([]);
  });

  it("bounds the grounding sent to the agent and reserves budget from its size (api-initiatives-F7)", async () => {
    const token = await issueSessionFor("angela-torres", "40.1.0.3");
    const bigRows = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, detail: "x".repeat(1000) }));
    const realProvider = dataModule.getProvider();
    const providerSpy = vi
      .spyOn(dataModule, "getProvider")
      .mockReturnValue(Object.assign(Object.create(realProvider), { auditQuery: async () => bigRows }));
    const auditorAnswer = vi.fn(async (input: { queryUsed: string }) => ({
      ok: true as const,
      value: { answerMd: "ok", citedEvents: [], queryUsed: input.queryUsed },
    }));
    const portSpy = vi.spyOn(agentsModule, "getAgentPort").mockReturnValue({ auditorAnswer } as never);
    const day = new Date().toISOString().slice(0, 10);
    try {
      const before = await getBudgetStoreForTests().getUsed(day);
      const { POST } = await import("../auditor/route");
      const res = await POST(
        new Request("http://localhost/api/chat/auditor", {
          method: "POST",
          headers: bearer(token, "40.1.0.3"),
          body: JSON.stringify({ question: "Which initiatives touch PHI?" }),
        }),
      );
      expect(res.status).toBe(200);
      const sent = auditorAnswer.mock.calls[0]![0] as unknown as { groundingRows: { detail: string }[] };
      expect(sent.groundingRows.length).toBeLessThanOrEqual(50);
      expect(Math.max(...sent.groundingRows.map((r) => r.detail.length))).toBeLessThanOrEqual(500);
      const reserved = (await getBudgetStoreForTests().getUsed(day)) - before;
      expect(reserved).toBeGreaterThanOrEqual(Math.ceil(JSON.stringify(sent.groundingRows).length / 4));
    } finally {
      portSpy.mockRestore();
      providerSpy.mockRestore();
    }
  });

  it("does not report initiative-not-found for an ordinary hyphenated word with no keyword (api-initiatives-F7)", async () => {
    const token = await issueSessionFor("angela-torres", "40.1.0.4");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.1.0.4"),
        body: JSON.stringify({ question: "Is a re-review expected soon?" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryUsed).toBe("member-facing-phi");
    expect(json.rows.length).toBeGreaterThan(0);
  });

  it("still reports initiative-not-found for an unknown three-segment slug (api-initiatives-F7)", async () => {
    const token = await issueSessionFor("angela-torres", "40.1.0.5");
    const { POST } = await import("../auditor/route");
    const res = await POST(
      new Request("http://localhost/api/chat/auditor", {
        method: "POST",
        headers: bearer(token, "40.1.0.5"),
        body: JSON.stringify({ question: "Show the history of no-such-initiative please" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryUsed).toBe("initiative-not-found:no-such-initiative");
    expect(json.rows).toEqual([]);
  });

  it("keeps the newest events when an initiative's history exceeds the grounding bound (api-initiatives-F7)", async () => {
    const token = await issueSessionFor("angela-torres", "40.1.0.6");
    const events = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, detail: `event ${i}` }));
    const realProvider = dataModule.getProvider();
    const providerSpy = vi.spyOn(dataModule, "getProvider").mockReturnValue(
      Object.assign(Object.create(realProvider), {
        getInitiativeDetail: async () => ({ summary: { slug: "member-chat-copilot" }, events }),
      }),
    );
    const auditorAnswer = vi.fn(async (input: { queryUsed: string }) => ({
      ok: true as const,
      value: { answerMd: "ok", citedEvents: [], queryUsed: input.queryUsed },
    }));
    const portSpy = vi.spyOn(agentsModule, "getAgentPort").mockReturnValue({ auditorAnswer } as never);
    try {
      const { POST } = await import("../auditor/route");
      const res = await POST(
        new Request("http://localhost/api/chat/auditor", {
          method: "POST",
          headers: bearer(token, "40.1.0.6"),
          body: JSON.stringify({ question: "Show the audit history of member-chat-copilot" }),
        }),
      );
      expect(res.status).toBe(200);
      const sent = auditorAnswer.mock.calls[0]![0] as unknown as { groundingRows: { id: string }[] };
      expect(sent.groundingRows).toHaveLength(50);
      expect(sent.groundingRows.map((r) => r.id)).toContain("e59");
      expect(sent.groundingRows.map((r) => r.id)).not.toContain("e0");
    } finally {
      portSpy.mockRestore();
      providerSpy.mockRestore();
    }
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

  it("does not reserve budget for a refused (403) or schema-invalid (400) call (auth-F4)", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const reviewer = await issueSessionFor("elena-vasquez", "41.1.0.1");
    const requester = await issueSessionFor("priya-raman", "41.1.0.2");
    const { POST } = await import("../intake/route");
    const before = await getBudgetStoreForTests().getUsed(day);
    const conversation = Array.from({ length: 10 }, () => ({ role: "user", content: "x".repeat(4000) }));
    const forbidden = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(reviewer, "41.1.0.1"),
        body: JSON.stringify({ conversation, partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(forbidden.status).toBe(403);
    const invalid = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(requester, "41.1.0.2"),
        body: JSON.stringify({ conversation, partialPayload: "not-an-object" }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await getBudgetStoreForTests().getUsed(day)).toBe(before);
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

  /* -----------------------------------------------------------------------
   * P1 cost-abuse fix: `partialPayload` was an unbounded z.record bypassing
   * every input cap, and the budget reservation was a flat constant
   * regardless of actual input size. These tests pin both fixes in place.
   * ---------------------------------------------------------------------- */

  it("400s an oversized partialPayload (input-cap failure) and never calls the agent port", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.8");
    const spy = vi.spyOn(agentsModule, "getAgentPort");
    try {
      const { POST } = await import("../intake/route");
      const res = await POST(
        new Request("http://localhost/api/chat/intake", {
          method: "POST",
          headers: bearer(token, "41.0.0.8"),
          body: JSON.stringify({
            conversation: [],
            partialPayload: { oversized: "x".repeat(25_000) },
          }),
        }),
      );
      expect(res.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("scales the budget reservation with actual input size (429s a large-but-legal body against a near-exhausted budget that a flat 600-token reservation would have admitted)", async () => {
    const { getBudgetStoreForTests } = await import("@/lib/services/route-guard");
    const store = getBudgetStoreForTests();
    const today = new Date().toISOString().slice(0, 10);
    // Mirrors lib/services/route-guard.ts's DAILY_TOKEN_CAP (500_000) as of
    // this test's writing. Top up usage so only ~5000 tokens remain today:
    // enough to admit a flat 600-token reservation, but not the
    // conversation-scaled estimate for a ~40k-char legal body (~10.6k
    // tokens), proving the reservation actually scales with input size.
    const DAILY_TOKEN_CAP_ASSUMED = 500_000;
    const REMAINING_TARGET = 5_000;
    const used = await store.getUsed(today);
    const topUp = DAILY_TOKEN_CAP_ASSUMED - used - REMAINING_TARGET;
    if (topUp > 0) {
      await store.addUsage(today, topUp);
    }

    const token = await issueSessionFor("priya-raman", "41.0.0.9");
    const { POST } = await import("../intake/route");
    const largeConversation = Array.from({ length: 10 }, () => ({
      role: "user" as const,
      content: "x".repeat(4000),
    }));
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.9"),
        body: JSON.stringify({ conversation: largeConversation, partialPayload: EMPTY_INTAKE_PAYLOAD }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("still 200s a normal small body (regression) with the mocked port reply", async () => {
    const token = await issueSessionFor("priya-raman", "41.0.0.10");
    const { POST } = await import("../intake/route");
    const res = await POST(
      new Request("http://localhost/api/chat/intake", {
        method: "POST",
        headers: bearer(token, "41.0.0.10"),
        body: JSON.stringify({
          conversation: [{ role: "user", content: "Hello, I'd like to start an intake." }],
          partialPayload: EMPTY_INTAKE_PAYLOAD,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.reply).toBe("string");
  });
});

/**
 * Budget-exhaustion tests use the current case's fresh PGlite database.
 * The shared store delegates to getDb(), so prior cases cannot exhaust this
 * case's allowance and test order does not provide isolation.
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
