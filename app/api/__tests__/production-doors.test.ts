// @vitest-environment node
/**
 * Production mode closes the demo-only doors.
 *
 * Passwordless persona sessions, the public intake door, the operator queue
 * and the synthetic-telemetry monitor exist for the public demo and nowhere
 * else. In production (JEEVES_MODE not exactly "demo") each one must answer
 * 404 BEFORE it parses a body, spends a rate-limit token, checks a secret or
 * touches the database, so a scanner learns nothing about it: not that it
 * exists (no 401/405/429), not whether a token was right, not what it
 * persists.
 *
 * Every case below configures the demo secrets (cookie secret, operator
 * token, cron secret) on purpose: a 404 caused by missing configuration
 * would pass for the wrong reason.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { sessions } from "@/lib/db/schema";
import { DemoOnlyError } from "@/lib/config/demo-doors";
import {
  issueDemoSession,
  issuePublicSession,
  resolveSession,
  resolveSessionActor,
  runMutationGuard,
} from "@/lib/services/route-guard";
import * as sessionRoute from "../session/route";
import * as publicSessionRoute from "../public-session/route";
import * as publicIntakeRoute from "../public-intake/route";
import * as monitorRunRoute from "../monitor/run/route";
import * as cronMonitorRoute from "../cron/monitor/route";
import OperatorPage, { generateMetadata as operatorMetadata } from "@/app/operator/page";

let testDb: TestDb;
const getDbSpy = vi.fn(() => testDb);
vi.mock("@/lib/db/client", () => ({ getDb: () => getDbSpy() }));

const OPERATOR_TOKEN = "operator-token-for-the-doors-test-0123456789";
const CRON_SECRET = "cron-secret-for-the-doors-test";
const COOKIE_SECRET = "cookie-secret-for-the-doors-test";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];
type Handler = (req: Request) => Response | Promise<Response>;
type RouteModule = Partial<Record<Method, Handler>>;

function asProduction(): void {
  vi.stubEnv("JEEVES_MODE", undefined);
}
function asDemo(): void {
  vi.stubEnv("JEEVES_MODE", "demo");
}

function request(path: string, method: Method, headers: Record<string, string> = {}, body?: unknown): Request {
  // GET and HEAD may not carry a body.
  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

/**
 * What a handler does for `method`, the way Next dispatches it: an exported
 * handler runs; HEAD falls back to GET; anything else is Next's own empty 405.
 */
async function dispatch(mod: RouteModule, method: Method, req: Request): Promise<Response> {
  const handler = mod[method] ?? (method === "HEAD" ? mod.GET : undefined);
  return handler ? handler(req) : new Response(null, { status: 405 });
}

async function sessionCount(): Promise<number> {
  return (await testDb.select().from(sessions)).length;
}

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await closeTestDb(testDb);
});
beforeEach(async () => {
  vi.stubEnv("JEEVES_COOKIE_SECRET", COOKIE_SECRET);
  vi.stubEnv("OPERATOR_TOKEN", OPERATOR_TOKEN);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  await testDb.delete(sessions);
  getDbSpy.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let nextClient = 0;

/** A persona session row and a public one, exactly as demo mode would have issued them. */
async function issueDemoRows(): Promise<{ persona: string; publicToken: string }> {
  asDemo();
  const persona = (await issueDemoSession("priya-raman"))!;
  // A fresh client per call: the public-session mint ceiling is per client.
  const publicSession = (await issuePublicSession(`203.0.113.${++nextClient}`)) as { token: string };
  asProduction();
  return { persona: persona.token, publicToken: publicSession.token };
}

describe("production: the demo-only doors answer 404 first", () => {
  type Door = { name: string; mod: RouteModule; path: string; implements: Method; probe: Record<string, string>; body?: unknown };
  const doors: Door[] = [
    {
      name: "/api/session",
      mod: sessionRoute as RouteModule,
      path: "/api/session",
      implements: "POST",
      probe: {},
      body: { personaKey: "priya-raman" },
    },
    {
      name: "/api/public-session",
      mod: publicSessionRoute as RouteModule,
      path: "/api/public-session",
      implements: "POST",
      probe: { "x-forwarded-for": "198.51.100.7" },
    },
    {
      name: "/api/public-intake",
      mod: publicIntakeRoute as RouteModule,
      path: "/api/public-intake",
      implements: "GET",
      probe: { authorization: `Bearer ${OPERATOR_TOKEN}` },
    },
    {
      name: "/api/monitor/run",
      mod: monitorRunRoute as RouteModule,
      path: "/api/monitor/run",
      implements: "POST",
      probe: {},
      body: { nowTs: "2026-07-15T00:00:00Z" },
    },
    {
      name: "/api/cron/monitor",
      mod: cronMonitorRoute as RouteModule,
      path: "/api/cron/monitor",
      implements: "GET",
      probe: { authorization: `Bearer ${CRON_SECRET}` },
    },
  ];

  describe.each(doors)("$name", (door) => {
    it.each(METHODS)("%s is a bare 404 that never reaches the database", async (method) => {
      asProduction();
      const res = await dispatch(door.mod, method, request(door.path, method, door.probe, door.body));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
      expect(res.headers.get("allow")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(getDbSpy).not.toHaveBeenCalled();
      expect(await sessionCount()).toBe(0);
    });

    it("is 404 with a valid persona session behind the request", async () => {
      const { persona } = await issueDemoRows();
      getDbSpy.mockClear();
      const res = await dispatch(
        door.mod,
        door.implements,
        request(door.path, door.implements, { ...door.probe, authorization: `Bearer ${persona}` }, door.body),
      );
      expect(res.status).toBe(404);
      expect(getDbSpy).not.toHaveBeenCalled();
    });
  });

  it("mode names that are not exactly 'demo' stay closed", async () => {
    for (const value of ["Demo", "DEMO", " demo ", "prod", "production", ""]) {
      vi.stubEnv("JEEVES_MODE", value);
      const res = await sessionRoute.POST(request("/api/session", "POST", {}, { personaKey: "priya-raman" }));
      expect(res.status, `JEEVES_MODE=${JSON.stringify(value)}`).toBe(404);
    }
  });

  it("a build that compiled the demo out stays closed even with JEEVES_MODE=demo", async () => {
    asDemo();
    vi.stubEnv("JEEVES_DEMO_ENABLED", "0");
    const res = await publicSessionRoute.POST(request("/api/public-session", "POST"));
    expect(res.status).toBe(404);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  // The operator queue is rate limited and token gated in demo. In production
  // none of that machinery runs, so hammering it can neither be told apart
  // from a missing route nor use up anything.
  it("never answers 401 or 429 to a wrong operator token, however often it is tried", async () => {
    asProduction();
    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await publicIntakeRoute.GET(
        request("/api/public-intake", "GET", { authorization: "Bearer wrong", "x-forwarded-for": "198.51.100.8" }),
      );
      expect(res.status).toBe(404);
    }
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("the cron route does not distinguish a missing CRON_SECRET (503) or a bad bearer (401)", async () => {
    asProduction();
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronMonitorRoute.GET(request("/api/cron/monitor", "GET"))).status).toBe(404);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(
      (await cronMonitorRoute.GET(request("/api/cron/monitor", "GET", { authorization: "Bearer nope" }))).status,
    ).toBe(404);
  });

  describe("/operator", () => {
    function notFoundDigest(fn: () => unknown): string | undefined {
      try {
        fn();
      } catch (error) {
        return (error as { digest?: string }).digest;
      }
      return undefined;
    }

    it("calls notFound() in production", () => {
      asProduction();
      expect(notFoundDigest(() => OperatorPage())).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    });

    // Next resolves a page's metadata separately from rendering it, so a page
    // that only 404s in its component would still put its title and
    // description into the 404 response's <head>.
    it("also keeps its title and description out of the 404", () => {
      asProduction();
      expect(notFoundDigest(() => operatorMetadata())).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });
});

describe("production: the session issuers refuse", () => {
  it("issueDemoSession throws a DemoOnlyError and writes nothing", async () => {
    asProduction();
    await expect(issueDemoSession("priya-raman")).rejects.toBeInstanceOf(DemoOnlyError);
    await expect(issueDemoSession("priya-raman", "ws_existing")).rejects.toBeInstanceOf(DemoOnlyError);
    expect(getDbSpy).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it("issuePublicSession throws a DemoOnlyError, spends no rate-limit token and writes nothing", async () => {
    asProduction();
    await expect(issuePublicSession("203.0.113.9")).rejects.toBeInstanceOf(DemoOnlyError);
    expect(getDbSpy).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it("the error names the door, not any configured value", async () => {
    asProduction();
    const error = await issueDemoSession("priya-raman").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoOnlyError);
    expect((error as Error).message).toMatch(/demo/i);
    expect((error as Error).message).not.toContain(COOKIE_SECRET);
  });
});

describe("production: resolveSession ignores persona and public sessions", () => {
  it("returns no actor and no workspace for a valid persona session row", async () => {
    const { persona } = await issueDemoRows();

    // Control: the row is real and unexpired; only the mode decides.
    asDemo();
    const inDemo = await resolveSession(persona);
    expect(inDemo.actor).toMatchObject({ id: "priya-raman", role: "requester" });
    expect(inDemo.workspaceId).toBeTruthy();

    asProduction();
    expect(await resolveSession(persona)).toEqual({ actor: null, workspaceId: null });
    expect(await resolveSessionActor(persona)).toBeNull();
  });

  it("returns no actor for a valid public session row either", async () => {
    const { publicToken } = await issueDemoRows();

    asDemo();
    expect((await resolveSession(publicToken)).actor?.role).toBe("public");

    asProduction();
    expect(await resolveSession(publicToken)).toEqual({ actor: null, workspaceId: null });
  });

  it("leaves the stored rows alone", async () => {
    const { persona } = await issueDemoRows();
    asProduction();
    await resolveSession(persona);
    expect(await sessionCount()).toBe(2);
  });

  it("makes the mutation guard answer 401 for a persona session", async () => {
    const { persona } = await issueDemoRows();
    asProduction();
    const result = await runMutationGuard(
      new Request("http://localhost/api/anything", {
        method: "POST",
        headers: { authorization: `Bearer ${persona}` },
      }),
      undefined,
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unauthorized", status: 401 } });
  });
});

describe("demo: the doors still work", () => {
  beforeEach(() => {
    asDemo();
  });

  it("POST /api/session issues a persona session", async () => {
    const res = await sessionRoute.POST(
      request("/api/session", "POST", { "x-forwarded-for": "192.0.2.10" }, { personaKey: "priya-raman" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await res.json()).toMatchObject({ token: expect.any(String), workspaceId: expect.any(String) });
    expect(await sessionCount()).toBe(1);
  });

  it("POST /api/public-session issues a public session in a public- workspace", async () => {
    const res = await publicSessionRoute.POST(
      request("/api/public-session", "POST", { "x-forwarded-for": "192.0.2.11" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceId).toMatch(/^public-/);
  });

  it("GET /api/public-intake is gated by OPERATOR_TOKEN", async () => {
    const ok = await publicIntakeRoute.GET(
      request("/api/public-intake", "GET", { authorization: `Bearer ${OPERATOR_TOKEN}` }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);

    const wrong = await publicIntakeRoute.GET(
      request("/api/public-intake", "GET", { authorization: "Bearer wrong", "x-forwarded-for": "192.0.2.12" }),
    );
    expect(wrong.status).toBe(401);

    vi.stubEnv("OPERATOR_TOKEN", "");
    const off = await publicIntakeRoute.GET(request("/api/public-intake", "GET"));
    expect(off.status).toBe(404);
  });

  it("GET /api/cron/monitor keeps its CRON_SECRET statuses", async () => {
    expect((await cronMonitorRoute.GET(request("/api/cron/monitor", "GET"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronMonitorRoute.GET(request("/api/cron/monitor", "GET"))).status).toBe(503);
  });

  it("POST /api/monitor/run still needs a session", async () => {
    const res = await monitorRunRoute.POST(
      request("/api/monitor/run", "POST", { "x-forwarded-for": "192.0.2.13" }, {}),
    );
    expect(res.status).toBe(401);
  });

  it("the other methods keep Next's defaults (empty 405, OPTIONS 204 with Allow)", async () => {
    const mod = sessionRoute as RouteModule;
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"] as const) {
      const res = await dispatch(mod, method, request("/api/session", method));
      expect(res.status, method).toBe(405);
      expect(await res.text()).toBe("");
    }
    const options = await dispatch(mod, "OPTIONS", request("/api/session", "OPTIONS"));
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("OPTIONS, POST");

    // GET routes keep the HEAD-from-GET behaviour Next adds automatically.
    const intake = publicIntakeRoute as RouteModule;
    expect(intake.HEAD).toBeUndefined();
    const intakeOptions = await dispatch(intake, "OPTIONS", request("/api/public-intake", "OPTIONS"));
    expect(intakeOptions.status).toBe(204);
    expect(intakeOptions.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    const post = await dispatch(intake, "POST", request("/api/public-intake", "POST"));
    expect(post.status).toBe(405);
  });

  it("the operator page renders and stays out of search", () => {
    expect(OperatorPage()).toBeTruthy();
    expect(operatorMetadata()).toMatchObject({ title: "Real requests", robots: { index: false, follow: false } });
  });

  it("the issuers still issue", async () => {
    expect(await issueDemoSession("priya-raman")).toMatchObject({ token: expect.any(String) });
    expect(await issuePublicSession("192.0.2.14")).toMatchObject({ token: expect.any(String) });
  });
});
