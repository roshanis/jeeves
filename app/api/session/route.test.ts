import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { sessions } from "@/lib/db/schema";
import { issuePublicSession, resetHousekeepingCounterForTests } from "@/lib/services/route-guard";
import { POST } from "./route";

let db: TestDb;
const getDbMock = vi.fn(() => db);
vi.mock("@/lib/db/client", () => ({ getDb: () => getDbMock() }));

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
  it("starts through an integration-only hosted database configuration", async () => {
    vi.stubEnv("DATA_PROVIDER", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "postgresql://fixture.invalid/hosted");
    const response = await enter();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

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
    getDbMock.mockClear();
    vi.stubEnv("JEEVES_COOKIE_SECRET", "");
    const response = await enter();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DEMO_NOT_CONFIGURED" });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("returns a safe storage error and logs only an allowlisted cause code", async () => {
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw Object.assign(new Error("postgres://private-user:private-password/private-db"), { code: "EROFS" });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await enter();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DEMO_STORAGE_UNAVAILABLE" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-password");
    expect(JSON.stringify(log.mock.calls)).toContain("EROFS");
    expect(log.mock.calls[0]?.[1]).toMatchObject({ requestId: expect.any(String), causeCode: "EROFS" });
    log.mockRestore();
  });

  it("recognizes a nested PostgreSQL code without logging its message or query", async () => {
    vi.spyOn(db, "insert").mockImplementation(() => {
      const cause = Object.assign(new Error("password=private-password; query=SELECT private_data"), { code: "42P01" });
      throw Object.assign(new Error("database operation failed", { cause }), { query: "SELECT private_data" });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await enter();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DEMO_STORAGE_UNAVAILABLE" });
    expect(log.mock.calls[0]?.[1]).toMatchObject({ requestId: expect.any(String), causeCode: "42P01" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-password");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SELECT private_data");
    log.mockRestore();
  });

  it("returns a safe error when the DB-backed session limiter fails", async () => {
    // Park the housekeeping counter: this test stubs db.execute and asserts the first console.error call.
    resetHousekeepingCounterForTests(1);
    const insert = vi.spyOn(db, "insert");
    const execute = vi.spyOn(db, "execute").mockImplementation(() => {
      throw Object.assign(new Error("postgres://private-user:private-password/private-db; query=SELECT private_data; ip=198.51.100.7"), { code: "ECONNRESET" });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await enter("priya-raman", { "x-forwarded-for": "198.51.100.7" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DEMO_STORAGE_UNAVAILABLE" });
    expect(execute).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[1]).toMatchObject({ requestId: expect.any(String), causeCode: "ECONNRESET" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("private-password");
    expect(logged).not.toContain("SELECT private_data");
    expect(logged).not.toContain("198.51.100.7");
    log.mockRestore();
  });

  it("still throttles anonymous session creation", async () => {
    for (let i = 0; i < 5; i++) expect((await enter()).status).toBe(200);
    const denied = await enter();
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBeTruthy();
  });

  it("charges a public parent to the anonymous workspace limiter, not the persona-switch one (auth-F11)", async () => {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    const pub = await issuePublicSession("203.0.113.50");
    if (!("token" in pub)) throw new Error("expected a public session");
    const headers = { ...ip, authorization: `Bearer ${pub.token}` };
    for (let i = 0; i < 5; i++) expect((await enter("priya-raman", headers)).status).toBe(200);
    expect((await enter("priya-raman", headers)).status).toBe(429);
  });
});

describe("cross-site session requests (auth-F10)", () => {
  it("refuses a foreign Origin with 403, no cookie, and no session row", async () => {
    const res = await enter("priya-raman", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("refuses a body not declared application/json with 415", async () => {
    const res = await POST(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ personaKey: "priya-raman" }),
    }));
    expect(res.status).toBe(415);
    expect(res.headers.has("set-cookie")).toBe(false);
  });

  it("still serves a same-origin Origin and a request with no Origin", async () => {
    expect((await enter("priya-raman", { origin: "http://localhost" })).status).toBe(200);
    expect((await enter("priya-raman")).status).toBe(200);
  });

  it("public-session refuses a foreign Origin and a declared non-JSON body, and serves a bare same-origin POST", async () => {
    vi.stubEnv("OPERATOR_TOKEN", "op-test-token-0123456789abcdefghijklmnop");
    const { POST: publicPost } = await import("../public-session/route");
    const foreign = await publicPost(new Request("http://localhost/api/public-session", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(foreign.status).toBe(403);
    const form = await publicPost(new Request("http://localhost/api/public-session", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
    expect(form.status).toBe(415);
    const ok = await publicPost(new Request("http://localhost/api/public-session", { method: "POST", headers: { origin: "http://localhost" } }));
    expect(ok.status).toBe(200);
  });
});
