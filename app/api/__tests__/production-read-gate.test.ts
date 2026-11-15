// @vitest-environment node
/**
 * Production has no anonymous reads.
 *
 * Demo serves seeded data to any visitor, scoped by a signed workspace cookie.
 * A production install must serve nothing without a session, on every read
 * path: server pages and GET route handlers alike. One missed GET leaks the
 * portfolio, so this file does not trust a list kept by hand:
 *
 *  1. INVENTORY (static). It walks app/ for every route.ts and page.tsx and
 *     requires each GET handler and each console page to call the viewer gate
 *     (lib/services/require-viewer.ts), or to sit on an allow-list that says
 *     why not. A new route that forgets the gate fails here.
 *  2. RUNTIME. It then imports every one of those modules, with no session,
 *     in production mode, and requires a 401 (routes) or a redirect to
 *     /sign-in (pages) before the database is queried. The static check says
 *     a gate exists; this one says it comes first and that a jeeves_workspace
 *     cookie, a bearer token or a stale persona session do not open it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signWorkspaceId } from "@/lib/security/workspace-cookie";

const ROOT = path.resolve(__dirname, "../../..");

// Stand-ins for the request scope Next gives server components, and a database
// that fails the test the moment anything queries it.
const stand = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
    }
  }
  class NotFound extends Error {}
  return { Redirected, NotFound, queried: [] as string[], requestHeaders: new Headers() };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => stand.requestHeaders,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new stand.Redirected(url);
  },
  notFound: (): never => {
    throw new stand.NotFound();
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/db/client", () => {
  // Handing the handle out is fine (providers hold one); using it is not.
  const poisoned = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined;
        stand.queried.push(String(property));
        throw new Error(`database queried (${String(property)}) before the viewer gate`);
      },
    },
  );
  return { getDb: () => poisoned };
});

/* ------------------------------ source scan ------------------------------ */

function walk(dir: string, basename: string, found: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, basename, found);
    else if (entry.name === basename) found.push(rel);
  }
  return found.sort();
}

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** The code with comments removed, so a call named only in prose does not count. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The body of `export [async] function name(...) { ... }`, by brace matching. */
function functionBody(rel: string, name: string): string {
  const text = code(rel);
  const start = text.search(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`));
  expect(start, `${name} not found in ${rel}`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("{", text.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

type GetKind = "handler" | "fallback" | "none";

/**
 * `handler`: the route implements GET itself. `fallback`: GET exists only as the
 * 405/404 stand-in from demoDoorFallbacks(), which has no data to leak.
 */
function getKind(rel: string): GetKind {
  const text = code(rel);
  if (/export\s+const\s*\{[^}]*\bGET\b[^}]*\}\s*=\s*demoDoorFallbacks\(/.test(text)) return "fallback";
  if (
    /export\s+(async\s+)?function\s+GET\b/.test(text) ||
    /export\s+const\s+GET\b/.test(text) ||
    /export\s*\{[^}]*\bGET\b[^}]*\}/.test(text)
  ) {
    return "handler";
  }
  return "none";
}

const routes = walk("app", "route.ts");
const pages = walk("app", "page.tsx");
const getHandlers = routes.filter((r) => getKind(r) === "handler");
const consolePages = pages.filter((p) => p.startsWith("app/(console)/"));

/* -------------------------------- allow-lists ----------------------------- */

/**
 * GET handlers that are deliberately not behind the viewer gate. Every entry
 * needs a reason; "door" entries are demo-only routes that must answer 404 in
 * production before they do anything else (lib/config/demo-doors.ts).
 */
const ROUTE_ALLOW_LIST: Record<string, { kind: "public" | "door"; why: string }> = {
  "app/api/health/route.ts": {
    kind: "public",
    why: "container and load-balancer probe: has no session by necessity and reveals only a status word",
  },
  "app/api/public-intake/route.ts": {
    kind: "door",
    why: "operator queue of real inbound requests, gated by OPERATOR_TOKEN in demo; 404 in production",
  },
  "app/api/cron/monitor/route.ts": {
    kind: "door",
    why: "scheduled synthetic-telemetry monitor, gated by CRON_SECRET in demo; 404 in production",
  },
};

/** Pages outside the console group, each with the reason it needs no viewer. */
const PAGE_ALLOW_LIST: Record<string, string> = {
  "app/sign-in/page.tsx": "the page an unauthenticated visitor is sent to; it shows no data",
  "app/operator/page.tsx": "demo-only operator queue: notFound() in production, token-gated data in demo",
};

/**
 * Console pages read through these helpers in app/_lib/data-provider.ts, each
 * of which is itself gated (asserted below), so a page that calls one is gated.
 */
const GATED_PAGE_HELPERS = [
  "getCurrentWorkspaceId",
  "getInitiativeDetailCoherent",
  "getInitiativeDetailForViewer",
  "listInitiativesForViewer",
];

describe("route inventory: every read path is behind the viewer gate", () => {
  it("finds the routes and pages it is meant to guard", () => {
    // A walker that silently found nothing would pass everything below.
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(getHandlers).toEqual(
      expect.arrayContaining([
        "app/api/exceptions/route.ts",
        "app/api/monitor/incidents/route.ts",
        "app/api/deployments/promotions/route.ts",
        "app/api/initiatives/[id]/intake/route.ts",
        "app/api/initiatives/[id]/draft-run/route.ts",
        "app/api/initiatives/[id]/evidence/route.ts",
        "app/api/initiatives/[id]/evidence/[documentId]/route.ts",
        "app/(console)/initiatives/[slug]/detail-data/route.ts",
      ]),
    );
    expect(consolePages.length).toBeGreaterThanOrEqual(12);
  });

  it.each(getHandlers.filter((r) => !(r in ROUTE_ALLOW_LIST)))("%s calls requireViewerForRequest", (route) => {
    expect(code(route)).toMatch(/\brequireViewerForRequest\(/);
  });

  it.each(Object.entries(ROUTE_ALLOW_LIST))("allow-listed %s is real and does what its entry says", (route, entry) => {
    expect(getKind(route), `${route} no longer implements GET: drop it from the allow-list`).toBe("handler");
    expect(entry.why.length).toBeGreaterThan(20);
    if (entry.kind === "door") {
      expect(functionBody(route, "GET")).toMatch(/\bdemoDoorClosed\(\)/);
    } else {
      expect(code(route)).not.toMatch(/\bgetDb\(\)\.(select|insert|update|delete)/);
    }
    // Gated and allow-listed at once means one of the two is stale.
    expect(code(route)).not.toMatch(/\brequireViewerForRequest\(/);
  });

  it("covers a GET that only exists as a demoDoorFallbacks() stand-in", () => {
    const fallbacks = routes.filter((r) => getKind(r) === "fallback");
    expect(fallbacks).toEqual(
      expect.arrayContaining(["app/api/session/route.ts", "app/api/public-session/route.ts", "app/api/monitor/run/route.ts"]),
    );
  });

  it.each(consolePages)("console page %s reads only behind the gate", (page) => {
    const text = code(page);
    const direct = /\brequireViewer\(/.test(text);
    const viaHelper = GATED_PAGE_HELPERS.some((helper) => new RegExp(`\\b${helper}\\(`).test(text));
    expect(direct || viaHelper, `${page} neither calls requireViewer() nor a gated data helper`).toBe(true);
  });

  it("gates each data helper the console pages read through", () => {
    for (const helper of GATED_PAGE_HELPERS) {
      expect(functionBody("app/_lib/data-provider.ts", helper), helper).toMatch(
        /\b(requireViewer|getCurrentWorkspaceId)\(/,
      );
    }
    expect(functionBody("app/_lib/data-provider.ts", "getCurrentWorkspaceId")).toMatch(/\brequireViewer\(\)/);
    expect(functionBody("app/_lib/data-provider.ts", "getInitiativeDetailCoherent")).toMatch(/\brequireViewer\(\)/);
  });

  it("gates the console top bar's workspace read", () => {
    expect(code("components/jeeves/console-top-bar.tsx")).toMatch(/\bgetCurrentWorkspaceId\(\)/);
  });

  it("routes the request-scoped workspace resolver through the gate", () => {
    expect(functionBody("lib/services/viewer-workspace.ts", "resolveViewerWorkspaceId")).toMatch(
      /\brequireViewerForRequest\(/,
    );
  });

  it("allows only the named pages outside the console and marketing groups", () => {
    const others = pages.filter((p) => !p.startsWith("app/(console)/") && !p.startsWith("app/(marketing)/"));
    expect(others.sort()).toEqual(Object.keys(PAGE_ALLOW_LIST).sort());
    for (const [page, why] of Object.entries(PAGE_ALLOW_LIST)) {
      expect(why.length, page).toBeGreaterThan(20);
    }
  });

  it("keeps the marketing pages free of tenant data", () => {
    // Static brochureware. If one starts reading data it must join the console
    // group or call the gate; production hides the group wholesale.
    for (const page of pages.filter((p) => p.startsWith("app/(marketing)/"))) {
      expect(code(page), page).not.toMatch(/data-provider|@\/lib\/data|@\/lib\/db|@\/lib\/services/);
    }
  });
});

/* --------------------------------- runtime -------------------------------- */

const COOKIE_SECRET = "production-read-gate-cookie-secret-0123456789";
const PARAMS = { id: "x", slug: "x", documentId: "x", cycleId: "x", domain: "legal" };

/** Everything a caller could present short of a real production session. */
const CREDENTIALS: Record<string, Record<string, string>> = {
  "no credentials": {},
  "a signed jeeves_workspace cookie": {
    cookie: `jeeves_workspace=${encodeURIComponent(signWorkspaceId("ws_visitor_0123456789", COOKIE_SECRET))}`,
  },
  "a bearer token": { authorization: "Bearer a-token-that-looks-plausible" },
  "a jeeves_session cookie": { cookie: "jeeves_session=a-token-that-looks-plausible" },
};

beforeEach(() => {
  vi.stubEnv("JEEVES_MODE", undefined);
  vi.stubEnv("JEEVES_COOKIE_SECRET", COOKIE_SECRET);
  stand.queried.length = 0;
  stand.requestHeaders = new Headers();
});
afterEach(() => vi.unstubAllEnvs());

type RouteModule = { GET: (req: Request, context: { params: Promise<typeof PARAMS> }) => Promise<Response> };

describe("production: an anonymous GET is refused before any data is read", () => {
  const gated = getHandlers.filter((r) => !(r in ROUTE_ALLOW_LIST));

  describe.each(gated)("%s", (route) => {
    it.each(Object.entries(CREDENTIALS))("answers 401 for %s", async (_label, headers) => {
      const mod = (await import(path.join(ROOT, route))) as RouteModule;
      const url = "http://localhost/api/x?cycleId=x&status=requested";
      const res = await mod.GET(new Request(url, { headers }), { params: Promise.resolve(PARAMS) });

      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
      expect(stand.queried).toEqual([]);
      const body = await res.text();
      expect(body).not.toMatch(/Meridian|initiative|slug/i);
    });
  });

  describe.each(consolePages)("%s", (page) => {
    it.each(Object.entries(CREDENTIALS))("redirects to /sign-in for %s", async (_label, headers) => {
      stand.requestHeaders = new Headers(headers);
      const mod = (await import(path.join(ROOT, page))) as {
        default: (props: { params: Promise<typeof PARAMS>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
      };

      await expect(
        mod.default({ params: Promise.resolve(PARAMS), searchParams: Promise.resolve({}) }),
      ).rejects.toMatchObject({ url: "/sign-in" });
      expect(stand.queried).toEqual([]);
    });
  });

  it("serves the health probe without a session", async () => {
    const mod = (await import(path.join(ROOT, "app/api/health/route.ts"))) as { GET: () => Promise<Response> };
    const res = await mod.GET();
    // The database is poisoned above, so this is the "degraded" answer; the
    // point is that the probe does not demand a session.
    expect(res.status).not.toBe(401);
  });

  it("answers 503, not data, when the server failed to boot", async () => {
    const { markBootFailed, resetBootStateForTests } = await import("@/lib/config/boot-state");
    markBootFailed("simulated");
    try {
      for (const route of gated) {
        const mod = (await import(path.join(ROOT, route))) as RouteModule;
        const res = await mod.GET(new Request("http://localhost/api/x?cycleId=x"), { params: Promise.resolve(PARAMS) });
        expect(res.status, route).toBe(503);
      }
      expect(stand.queried).toEqual([]);
    } finally {
      resetBootStateForTests();
    }
  });
});
