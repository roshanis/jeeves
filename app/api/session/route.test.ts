import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { sessions } from "@/lib/db/schema";
import { POST } from "./route";

let db: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));

function enter(personaKey = "priya-raman", headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ personaKey }),
  }));
}

beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv("DEMO_PASSCODE", "");
  vi.stubEnv("JEEVES_COOKIE_SECRET", "test-only-visitor-workspace-signing-secret");
});
afterEach(async () => { await closeTestDb(db); vi.unstubAllEnvs(); });

describe("public demo entry", () => {
  it("starts without a password and gives different visitors different workspaces", async () => {
    const first = await enter();
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    const a = await first.json();
    const b = await (await enter()).json();
    expect(a.workspaceId).toBeTruthy();
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it("switches persona in the authenticated workspace even with another valid browser cookie", async () => {
    const a = await enter();
    const first = await a.json();
    const b = await enter();
    const otherCookie = b.headers.get("set-cookie")!.split(";")[0]!;
    const switched = await enter("marcus-webb", {
      authorization: `Bearer ${first.token}`, cookie: otherCookie,
    });
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({ workspaceId: first.workspaceId });
    expect((await db.select().from(sessions)).at(-1)?.personaKey).toBe("marcus-webb");
  });

  it("rejects an invalid switching token without issuing a session", async () => {
    expect((await enter("ray-chen", { authorization: "Bearer unknown" })).status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("rejects unknown personas and missing signing configuration without creating sessions", async () => {
    expect((await enter("unknown-persona")).status).toBe(401);
    vi.stubEnv("JEEVES_COOKIE_SECRET", "");
    expect((await enter()).status).toBe(503);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("still throttles anonymous session creation", async () => {
    for (let i = 0; i < 5; i++) expect((await enter()).status).toBe(200);
    const denied = await enter();
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBeTruthy();
  });
});
