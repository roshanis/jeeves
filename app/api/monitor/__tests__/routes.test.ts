/**
 * HTTP-layer tests for app/api/monitor/** (task brief deliverable 3 + 4):
 * POST /api/monitor/run (session required, any role, budget-reserved) and
 * GET /api/monitor/incidents (public read-only). Mirrors the guard-order
 * conventions of app/api/__tests__/routes.test.ts (401 -> 429 -> 400 -> 403).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { resetGuardStateForTests } from "@/lib/services/route-guard";
import { seedDatabase } from "@/scripts/seed";
import { initiatives } from "@/lib/db/schema";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const PASSCODE = "demo-passcode-for-tests";

beforeEach(async () => {
  process.env.DEMO_PASSCODE = PASSCODE;
  testDb = await createTestDb();
  await seedDatabase(testDb);
  resetGuardStateForTests();
});

afterEach(async () => {
  await closeTestDb(testDb);
});

function bearer(token: string, ip = "20.20.20.1"): HeadersInit {
  return { authorization: `Bearer ${token}`, "x-forwarded-for": ip, "content-type": "application/json" };
}

async function issueSessionFor(personaKey: string, ip = "20.20.20.1"): Promise<string> {
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

describe("POST /api/monitor/run", () => {
  it("401s an unauthenticated request", async () => {
    const { POST } = await import("../run/route");
    const res = await POST(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "21.0.0.1" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("200s for ANY authenticated role (e.g. program office, not just admin)", async () => {
    const token = await issueSessionFor("nia-okafor", "21.0.0.2"); // program role
    const { POST } = await import("../run/route");
    const res = await POST(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: bearer(token, "21.0.0.2"),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.evaluated).toBe("number");
    expect(Array.isArray(json.breaches)).toBe(true);
  });

  it("defaults nowTs to base+14d and detects the #4 member-chat-copilot breach with no body at all", async () => {
    const token = await issueSessionFor("ray-chen", "21.0.0.3");
    const { POST } = await import("../run/route");
    const res = await POST(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: bearer(token, "21.0.0.3"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.incidentsCreated).toBe(1);

    const [init] = await testDb.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
    expect(init!.state).toBe("re_review");
  });

  it("honors an explicit nowTs in the body — base+8d does not yet breach", async () => {
    const token = await issueSessionFor("ray-chen", "21.0.0.4");
    const { POST } = await import("../run/route");
    const nowTs = new Date(Date.parse("2026-07-01T00:00:00Z") + 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: bearer(token, "21.0.0.4"),
        body: JSON.stringify({ nowTs }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.incidentsCreated).toBe(0);
  });

  it("400s an invalid nowTs", async () => {
    const token = await issueSessionFor("ray-chen", "21.0.0.5");
    const { POST } = await import("../run/route");
    const res = await POST(
      new Request("http://localhost/api/monitor/run", {
        method: "POST",
        headers: bearer(token, "21.0.0.5"),
        body: JSON.stringify({ nowTs: "not-a-date" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("a second call is idempotent over HTTP: zero new incidents on re-run", async () => {
    const token = await issueSessionFor("ray-chen", "21.0.0.6");
    const { POST } = await import("../run/route");
    const first = await POST(
      new Request("http://localhost/api/monitor/run", { method: "POST", headers: bearer(token, "21.0.0.6") }),
    );
    expect((await first.json()).incidentsCreated).toBe(1);

    const second = await POST(
      new Request("http://localhost/api/monitor/run", { method: "POST", headers: bearer(token, "21.0.0.6") }),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).incidentsCreated).toBe(0);
  });
});

describe("GET /api/monitor/incidents — public read-only", () => {
  it("200s with no session/auth header at all", async () => {
    const { GET } = await import("../incidents/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.incidents)).toBe(true);
    expect(json.incidents).toHaveLength(0);
  });

  it("reflects a breach recorded by a prior monitor run", async () => {
    const token = await issueSessionFor("ray-chen", "21.0.0.7");
    const { POST } = await import("../run/route");
    await POST(new Request("http://localhost/api/monitor/run", { method: "POST", headers: bearer(token, "21.0.0.7") }));

    const { GET } = await import("../incidents/route");
    const res = await GET();
    const json = await res.json();
    expect(json.incidents.length).toBeGreaterThanOrEqual(1);
    expect(json.incidents[0].controlId).toBe("Q-01");
  });
});
