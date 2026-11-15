/**
 * U+0000 cannot be stored in Postgres text (error 22021). It is refused at the
 * boundary instead of surfacing as a 500 with the SQL and its parameters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { issueDemoSession } from "@/lib/services/route-guard";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = "nul-input-test-secret";
  testDb = await createTestDb();
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
});

function auth(token: string, ip = "7.7.7.7"): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": ip };
}

describe("NUL bytes at the boundary", () => {
  it("answers 404 to a NUL in a route id (GET intake)", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { GET } = await import("../initiatives/[id]/intake/route");
    const res = await GET(new Request("http://localhost/api/initiatives/%00/intake", { headers: auth(session.token) }), {
      params: Promise.resolve({ id: "\u0000" }),
    });
    expect(res.status).toBe(404);
  });

  it("answers 404 to a NUL in a route id (POST decide)", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../initiatives/[id]/decide/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives/%00/decide", {
        method: "POST",
        headers: auth(session.token),
        body: JSON.stringify({ decision: "rejected" }),
      }),
      { params: Promise.resolve({ id: "\u0000" }) },
    );
    expect(res.status).toBe(404);
  });

  it("answers 400 to a NUL inside a free-text field", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../exceptions/route");
    const res = await POST(
      new Request("http://localhost/api/exceptions", {
        method: "POST",
        headers: auth(session.token),
        body: JSON.stringify({ effectiveControlId: "exc-seed-hr-r01", reason: "a\u0000b" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("answers 400 to a NUL in the intake payload on POST /api/initiatives", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../initiatives/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        headers: auth(session.token),
        body: JSON.stringify({ requestId: "nul-request-0000001", payload: { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title: "NUL\u0000title" } } }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("treats a session cookie containing NUL as signed out (401)", async () => {
    const { POST } = await import("../exceptions/route");
    const res = await POST(
      new Request("http://localhost/api/exceptions", {
        method: "POST",
        headers: { cookie: "jeeves_session=%00", "content-type": "application/json", "x-forwarded-for": "7.7.7.8" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });
});
