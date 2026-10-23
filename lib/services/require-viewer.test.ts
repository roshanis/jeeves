// @vitest-environment node
/**
 * The read gate (lib/services/require-viewer.ts).
 *
 * Demo keeps today's anonymous, cookie-scoped reads. Production has no
 * anonymous view: a read needs a valid session, the `jeeves_workspace` cookie
 * grants nothing, and a server that failed to boot serves nothing.
 *
 * Production here is "JEEVES_MODE unset", which is how the mode flag defaults
 * (lib/config/deployment-mode.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { markBootFailed, resetBootStateForTests } from "../config/boot-state";
import { signWorkspaceId } from "../security/workspace-cookie";
import type { Actor } from "../domain/types";
import { issueDemoSession } from "./route-guard";
import { resolveViewerWorkspaceId } from "./viewer-workspace";
import {
  SIGN_IN_PATH,
  ViewerRequiredError,
  ViewerUnavailableError,
  requireViewer,
  requireViewerForRequest,
} from "./require-viewer";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

// Stand-ins for the request scope Next provides to server components.
const next = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
    }
  }
  return { Redirected, cookies: new Map<string, string>(), headers: new Headers() };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (next.cookies.has(name) ? { name, value: next.cookies.get(name)! } : undefined),
  }),
  headers: async () => next.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new next.Redirected(url);
  },
}));

// Production has no session type yet, so resolveSession answers nothing there.
// A test that needs "a valid production session" supplies one here; everything
// else passes through to the real implementation.
const fakeSession = vi.hoisted(() => ({
  resolve: null as null | ((token: string | null) => Promise<{ actor: Actor | null; workspaceId: string | null }>),
  tokens: [] as (string | null)[],
}));
vi.mock("@/lib/services/route-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./route-guard")>();
  return {
    ...actual,
    resolveSession: (token: string | null) => {
      fakeSession.tokens.push(token);
      return fakeSession.resolve ? fakeSession.resolve(token) : actual.resolveSession(token);
    },
  };
});

const COOKIE_SECRET = "require-viewer-cookie-secret-0123456789";
const SIGNED_COOKIE = (workspaceId: string) => `jeeves_workspace=${encodeURIComponent(signWorkspaceId(workspaceId, COOKIE_SECRET))}`;
const OTHER_WORKSPACE = "ws_other_workspace_0123456789";

function asProduction(): void {
  vi.stubEnv("JEEVES_MODE", undefined);
}
function asDemo(): void {
  vi.stubEnv("JEEVES_MODE", "demo");
}
function get(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/anything", { headers });
}

const PROGRAM: Actor = { id: "mei-chen", role: "program" };

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await closeTestDb(testDb);
});
beforeEach(() => {
  vi.stubEnv("JEEVES_COOKIE_SECRET", COOKIE_SECRET);
  next.cookies.clear();
  next.headers = new Headers();
  fakeSession.resolve = null;
  fakeSession.tokens.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetBootStateForTests();
});

describe("demo: reads stay open and workspace-scoped, exactly as before", () => {
  beforeEach(asDemo);

  it("lets an anonymous request through on the seeded-only view", async () => {
    const gate = await requireViewerForRequest(get());
    expect(gate).toEqual({ ok: true, viewer: { actor: null, workspaceId: null } });
  });

  it("scopes a request to its signed jeeves_workspace cookie", async () => {
    const gate = await requireViewerForRequest(get({ cookie: SIGNED_COOKIE("ws_visitor_0123456789") }));
    expect(gate).toEqual({ ok: true, viewer: { actor: null, workspaceId: "ws_visitor_0123456789" } });
  });

  it("treats a tampered workspace cookie as no workspace, never an error", async () => {
    const forged = `jeeves_workspace=${encodeURIComponent("ws_visitor_0123456789.deadbeef")}`;
    const gate = await requireViewerForRequest(get({ cookie: forged }));
    expect(gate).toEqual({ ok: true, viewer: { actor: null, workspaceId: null } });
  });

  it("gives a valid session its own workspace and actor, ahead of a cookie hint", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const gate = await requireViewerForRequest(
      get({ authorization: `Bearer ${session.token}`, cookie: SIGNED_COOKIE(OTHER_WORKSPACE) }),
    );
    expect(gate).toMatchObject({
      ok: true,
      viewer: { workspaceId: session.workspaceId, actor: { id: "priya-raman" } },
    });
  });

  it("falls back to the cookie when the session token is unknown", async () => {
    const gate = await requireViewerForRequest(
      get({ authorization: "Bearer not-a-real-token", cookie: SIGNED_COOKIE("ws_visitor_0123456789") }),
    );
    expect(gate).toEqual({ ok: true, viewer: { actor: null, workspaceId: "ws_visitor_0123456789" } });
  });

  it("requireViewer() reads the signed jeeves_workspace cookie of the page request", async () => {
    next.cookies.set("jeeves_workspace", signWorkspaceId("ws_visitor_0123456789", COOKIE_SECRET));
    await expect(requireViewer()).resolves.toEqual({ actor: null, workspaceId: "ws_visitor_0123456789" });
  });

  it("requireViewer() serves a page with no cookie as the seeded-only view, without redirecting", async () => {
    await expect(requireViewer()).resolves.toEqual({ actor: null, workspaceId: null });
  });

  it("requireViewer() ignores an unsigned cookie", async () => {
    next.cookies.set("jeeves_workspace", "ws_visitor_0123456789");
    await expect(requireViewer()).resolves.toEqual({ actor: null, workspaceId: null });
  });

  it("resolveViewerWorkspaceId() still answers null for an anonymous request", async () => {
    await expect(resolveViewerWorkspaceId(get())).resolves.toBeNull();
  });
});

describe("production: no session, no read", () => {
  beforeEach(asProduction);

  it("answers an anonymous request 401 with a JSON error and no-store", async () => {
    const gate = await requireViewerForRequest(get());
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(401);
    expect(gate.response.headers.get("cache-control")).toBe("no-store");
    expect(await gate.response.json()).toEqual({ error: "invalid or missing session" });
  });

  it("gives the jeeves_workspace cookie no standing, signed or not", async () => {
    for (const cookie of [SIGNED_COOKIE("ws_visitor_0123456789"), "jeeves_workspace=ws_visitor_0123456789"]) {
      const gate = await requireViewerForRequest(get({ cookie }));
      expect(gate.ok, cookie).toBe(false);
      if (!gate.ok) expect(gate.response.status).toBe(401);
    }
  });

  it("does not honour a persona session row left over from a demo database", async () => {
    asDemo();
    const persona = (await issueDemoSession("priya-raman"))!;
    asProduction();
    const presented: Record<string, string>[] = [
      { authorization: `Bearer ${persona.token}` },
      { cookie: `jeeves_session=${persona.token}` },
      { authorization: `Bearer ${persona.token}`, cookie: SIGNED_COOKIE(persona.workspaceId) },
    ];
    for (const headers of presented) {
      const gate = await requireViewerForRequest(get(headers));
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.response.status).toBe(401);
    }
  });

  it("lets a valid session read, scoped to the SESSION's workspace and never the cookie's", async () => {
    fakeSession.resolve = async () => ({ actor: PROGRAM, workspaceId: "ws_org_0123456789" });
    const gate = await requireViewerForRequest(
      get({ authorization: "Bearer session-token", cookie: SIGNED_COOKIE(OTHER_WORKSPACE) }),
    );
    expect(gate).toEqual({ ok: true, viewer: { actor: PROGRAM, workspaceId: "ws_org_0123456789" } });
    expect(fakeSession.tokens).toEqual(["session-token"]);
  });

  it("refuses a session that has no workspace", async () => {
    fakeSession.resolve = async () => ({ actor: PROGRAM, workspaceId: null });
    const gate = await requireViewerForRequest(get({ authorization: "Bearer session-token" }));
    expect(gate.ok).toBe(false);
  });

  it("refuses a public-role session even if one were presented", async () => {
    fakeSession.resolve = async () => ({
      actor: { id: "public:abc", role: "public" },
      workspaceId: "public-ws_0123456789",
    });
    const gate = await requireViewerForRequest(get({ authorization: "Bearer session-token" }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
  });

  it("resolveViewerWorkspaceId() throws instead of answering the seeded-only view", async () => {
    await expect(resolveViewerWorkspaceId(get())).rejects.toBeInstanceOf(ViewerRequiredError);
    await expect(resolveViewerWorkspaceId(get({ cookie: SIGNED_COOKIE("ws_visitor_0123456789") }))).rejects.toBeInstanceOf(
      ViewerRequiredError,
    );
  });

  it("resolveViewerWorkspaceId() returns the session workspace for a valid session", async () => {
    fakeSession.resolve = async () => ({ actor: PROGRAM, workspaceId: "ws_org_0123456789" });
    await expect(resolveViewerWorkspaceId(get({ authorization: "Bearer session-token" }))).resolves.toBe(
      "ws_org_0123456789",
    );
  });

  describe("pages", () => {
    it("redirects to /sign-in when there is no session", async () => {
      await expect(requireViewer()).rejects.toMatchObject({ url: SIGN_IN_PATH });
      expect(SIGN_IN_PATH).toBe("/sign-in");
    });

    it("redirects even with a signed workspace cookie on the request", async () => {
      next.cookies.set("jeeves_workspace", signWorkspaceId("ws_visitor_0123456789", COOKIE_SECRET));
      next.headers = new Headers({ cookie: SIGNED_COOKIE("ws_visitor_0123456789") });
      await expect(requireViewer()).rejects.toBeInstanceOf(next.Redirected);
    });

    it("returns the viewer for a valid session carried in the request headers", async () => {
      fakeSession.resolve = async () => ({ actor: PROGRAM, workspaceId: "ws_org_0123456789" });
      next.headers = new Headers({ cookie: `jeeves_session=page-token; jeeves_workspace=ignored` });
      await expect(requireViewer()).resolves.toEqual({ actor: PROGRAM, workspaceId: "ws_org_0123456789" });
      expect(fakeSession.tokens).toEqual(["page-token"]);
    });
  });
});

describe.each([
  ["demo", asDemo],
  ["production", asProduction],
])("%s: a server that failed to boot serves no reads", (_mode, setMode) => {
  beforeEach(() => {
    setMode();
    markBootFailed("simulated boot failure with a secret-looking value hunter2");
  });

  it("answers requests 503 without leaking the reason", async () => {
    const gate = await requireViewerForRequest(get({ cookie: SIGNED_COOKIE("ws_visitor_0123456789") }));
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(503);
    expect(gate.response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await gate.response.json())).not.toContain("hunter2");
  });

  it("fails pages closed", async () => {
    await expect(requireViewer()).rejects.toBeInstanceOf(ViewerUnavailableError);
  });

  it("makes resolveViewerWorkspaceId() throw", async () => {
    await expect(resolveViewerWorkspaceId(get())).rejects.toBeInstanceOf(ViewerRequiredError);
  });
});
