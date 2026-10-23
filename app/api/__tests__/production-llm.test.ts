// @vitest-environment node
/**
 * Production with no LLM answers every LLM route with a clean 503
 * `llm_not_configured`: not a 500, not a canned mock answer, not an
 * "initialization failed" that blames the deployed prompts.
 *
 * Production has no session type yet (single sign-on is a later slice), so
 * these cases stand in an authenticated caller by replacing runMutationGuard.
 * The 503 is the thing under test: it must come AFTER authentication (an
 * unauthenticated caller never learns the LLM state) and BEFORE any provider
 * call or database claim.
 *
 * Demo keeps its keyless mock default, asserted against the same routes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { reserve } from "@/lib/security/budget";
import { getBudgetStoreForTests } from "@/lib/services/route-guard";
import { auditEvents, initiatives, intakeVersions, reviewCycles, reviewDecisions, riskAssessments, runBudget } from "@/lib/db/schema";
import * as chatAuditor from "../chat/auditor/route";
import * as chatIntake from "../chat/intake/route";
import * as agentsHealth from "../agents/health/route";
import * as draftRun from "../initiatives/[id]/draft-run/route";
import * as reviewRun from "../reviews/[cycleId]/[domain]/run/route";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

const guard = vi.hoisted(() => ({ runMutationGuard: vi.fn() }));
vi.mock("@/lib/services/route-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/route-guard")>()),
  runMutationGuard: guard.runMutationGuard,
}));

const WORKSPACE = "workspace-prod";
const at = new Date("2026-09-19T10:00:00Z");

beforeAll(async () => {
  testDb = await createTestDb();
  await testDb.insert(initiatives).values({ id: "i", slug: "no-llm-fixture", title: "Fictional review", requester: "Priya Raman", state: "in_review", workspaceId: WORKSPACE, createdAt: at, updatedAt: at });
  await testDb.insert(intakeVersions).values({ id: "iv", initiativeId: "i", version: 1, submitted: true, fields: { useCase: "Synthetic test" }, createdAt: at });
  await testDb.insert(riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "iv", tier: "high", flags: {}, requiredDomains: ["legal"], createdAt: at });
  await testDb.insert(reviewCycles).values({ id: "cycle", initiativeId: "i", kind: "initial", riskAssessmentId: "risk", openedAt: at });
  await testDb.insert(reviewDecisions).values({ id: "review", cycleId: "cycle", domain: "legal", status: "pending", revision: 0, createdAt: at });
});
afterAll(async () => closeTestDb(testDb));

function signedInAs(actorId: string, role: string): void {
  guard.runMutationGuard.mockResolvedValue({ ok: true, actor: { id: actorId, role }, workspaceId: WORKSPACE });
}
beforeEach(() => {
  guard.runMutationGuard.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

function asProduction(key?: string): void {
  vi.stubEnv("JEEVES_MODE", undefined);
  vi.stubEnv("OPENAI_API_KEY", key);
}

function post(path: string, body: unknown = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EMPTY_PAYLOAD = { basics: {}, useCase: {}, data: {}, modelVendor: {}, populationImpact: {}, deployment: {}, overlay: {}, evidenceAttachments: [] };

interface LlmRoute {
  name: string;
  actor: [string, string];
  call: () => Promise<Response>;
}

const ROUTES: LlmRoute[] = [
  {
    name: "POST /api/chat/intake",
    actor: ["priya-raman", "requester"],
    call: () => chatIntake.POST(post("/api/chat/intake", { conversation: [{ role: "user", content: "hello" }], partialPayload: EMPTY_PAYLOAD })),
  },
  {
    name: "POST /api/chat/auditor",
    actor: ["angela-torres", "approver"],
    call: () => chatAuditor.POST(post("/api/chat/auditor", { question: "Which member-facing tools touch PHI?" })),
  },
  {
    name: "POST /api/agents/health",
    actor: ["ray-chen", "admin"],
    call: () => agentsHealth.POST(post("/api/agents/health")),
  },
  {
    name: "POST /api/initiatives/[id]/draft-run",
    actor: ["priya-raman", "requester"],
    call: () => draftRun.POST(post("/api/initiatives/i/draft-run", { domains: ["legal"] }), { params: Promise.resolve({ id: "i" }) }),
  },
  {
    name: "POST /api/reviews/[cycleId]/[domain]/run",
    actor: ["james-liu", "reviewer"],
    call: () => reviewRun.POST(post("/api/reviews/cycle/legal/run"), { params: Promise.resolve({ cycleId: "cycle", domain: "legal" }) }),
  },
];

describe.each(ROUTES)("$name in production without OPENAI_API_KEY", ({ actor, call }) => {
  it("answers 503 llm_not_configured", async () => {
    asProduction(undefined);
    signedInAs(...actor);
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "llm_not_configured" });
  });

  it("answers an unauthenticated caller with the guard's refusal, never the LLM state", async () => {
    asProduction(undefined);
    guard.runMutationGuard.mockResolvedValue({ ok: false, failure: { status: 401, message: "invalid or missing session" } });
    const response = await call();
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toMatch(/llm_not_configured/);
  });
});

describe("a refused draft run leaves no trace", () => {
  it("claims nothing, reserves nothing and writes no audit row", async () => {
    asProduction(undefined);
    signedInAs("priya-raman", "requester");
    const response = await draftRun.POST(post("/api/initiatives/i/draft-run", { domains: ["legal"] }), { params: Promise.resolve({ id: "i" }) });
    expect(response.status).toBe(503);

    const [review] = await testDb.select().from(reviewDecisions).where(eq(reviewDecisions.id, "review"));
    expect(review).toMatchObject({ status: "pending", revision: 0, activeAttemptId: null });
    expect(await testDb.select().from(runBudget)).toEqual([]);
    expect(await testDb.select().from(auditEvents)).toEqual([]);
  });
});

// The chat routes ask the mutation guard for a token reservation, which is the
// only thing that spends the daily LLM budget. With no LLM there is nothing to
// spend it on, so they must not ask. The guard is replaced in this file, so it
// is stood in by its budget step: the same reserve() against the same store,
// whenever the route passes `requiresBudget`.
describe("chat routes reserve no tokens when the install has no LLM", () => {
  const CHAT_ROUTES = ROUTES.filter((route) => route.name.startsWith("POST /api/chat/"));

  function guardThatReservesLikeTheRealOne(actorId: string, role: string): void {
    guard.runMutationGuard.mockImplementation(async (_req: Request, _body: unknown, options: { requiresBudget?: boolean; estimatedTokens?: number } = {}) => {
      if (options.requiresBudget) await reserve(getBudgetStoreForTests(), "2026-09-19", options.estimatedTokens ?? 0, 500_000);
      return { ok: true, actor: { id: actorId, role }, workspaceId: WORKSPACE };
    });
  }

  afterEach(async () => {
    await testDb.delete(runBudget);
  });

  it.each(CHAT_ROUTES)("$name answers 503 and leaves run_budget untouched", async ({ actor, call }) => {
    asProduction(undefined);
    guardThatReservesLikeTheRealOne(...actor);

    const response = await call();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "llm_not_configured" });
    expect(await testDb.select().from(runBudget)).toEqual([]);
    expect(guard.runMutationGuard.mock.calls[0][2]).toMatchObject({ requiresBudget: false });
  });

  it.each(CHAT_ROUTES)("$name still authenticates first: an anonymous caller gets the guard's 401", async ({ call }) => {
    asProduction(undefined);
    guard.runMutationGuard.mockResolvedValue({ ok: false, failure: { status: 401, message: "invalid or missing session" } });

    const response = await call();

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toMatch(/llm_not_configured/);
  });

  it("chat/intake still checks the persona before it reports the LLM state", async () => {
    asProduction(undefined);
    guardThatReservesLikeTheRealOne("angela-torres", "approver");

    const response = await chatIntake.POST(post("/api/chat/intake", { conversation: [{ role: "user", content: "hello" }], partialPayload: EMPTY_PAYLOAD }));

    expect(response.status).toBe(403);
    expect(await testDb.select().from(runBudget)).toEqual([]);
  });

  it.each([
    ["chat/intake", () => chatIntake.POST(post("/api/chat/intake", { conversation: "not a list" })), "priya-raman", "requester"],
    ["chat/auditor", () => chatAuditor.POST(post("/api/chat/auditor", {})), "angela-torres", "approver"],
  ] as const)("%s still validates the body before it reports the LLM state", async (_name, call, actorId, role) => {
    asProduction(undefined);
    guardThatReservesLikeTheRealOne(actorId, role);

    const response = await call();

    expect(response.status).toBe(400);
    expect(await testDb.select().from(runBudget)).toEqual([]);
  });

  // Positive control: the stand-in does see a reservation, and demo still makes one.
  it.each(CHAT_ROUTES)("$name reserves tokens in demo, where the keyless mock answers", async ({ actor, call }) => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    guardThatReservesLikeTheRealOne(...actor);

    const response = await call();

    expect(response.status).toBe(200);
    expect(guard.runMutationGuard.mock.calls[0][2]).toMatchObject({ requiresBudget: true });
    expect(await testDb.select().from(runBudget)).toHaveLength(1);
  });
});

describe("the same routes in demo without a key", () => {
  beforeEach(() => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("OPENAI_API_KEY", undefined);
  });

  it("chat/intake keeps answering from the deterministic mock", async () => {
    signedInAs("priya-raman", "requester");
    const response = await chatIntake.POST(post("/api/chat/intake", { conversation: [{ role: "user", content: "hello" }], partialPayload: EMPTY_PAYLOAD }));
    expect(response.status).toBe(200);
  });

  it("agents/health keeps reporting the mock adapter", async () => {
    signedInAs("ray-chen", "admin");
    const response = await agentsHealth.POST(post("/api/agents/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ adapter: "mock", configured: false });
  });
});
