import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { ValidationError, decide } from "@/lib/services/initiative-service";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = "test-only-workspace-cookie-secret";
  testDb = await createTestDb();
});
afterEach(async () => {
  await closeTestDb(testDb);
});

async function approverToken(): Promise<string> {
  const { POST } = await import("../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personaKey: "angela-torres" }),
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function postDecide(body: unknown): Promise<Response> {
  const token = await approverToken();
  const { POST } = await import("../initiatives/[id]/decide/route");
  return POST(
    new Request("http://localhost/api/initiatives/some-initiative/decide", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "9.9.9.9", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "some-initiative" }) },
  );
}

describe("decide input validation", () => {
  it("rejects a conditional approval whose only condition is blank", async () => {
    const res = await postDecide({
      decision: "conditionally_approved",
      conditions: [{ text: "  ", controlId: "" }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects blank citations", async () => {
    const res = await postDecide({
      decision: "conditionally_approved",
      conditions: [{ text: "Monitor drift", controlId: "Q-01" }],
      citations: ["", "   "],
    });
    expect(res.status).toBe(400);
  });

  it.each([
    ["is missing", { decision: "rejected" }],
    ["is blank", { decision: "rejected", reason: "   " }],
    ["is over 2,000 characters", { decision: "rejected", reason: "x".repeat(2001) }],
  ])("answers 400 naming the reason field when a rejection's reason %s", async (_label, body) => {
    const res = await postDecide(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/reason/i);
  });

  it("decide() itself rejects blank conditions for non-HTTP callers", async () => {
    await expect(
      decide(testDb, "no-such-initiative", { id: "angela-torres", role: "approver" }, null, {
        decision: "conditionally_approved",
        conditions: [{ text: " ", controlId: "" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
