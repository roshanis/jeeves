// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CONSOLE_PATH_PREFIXES, DEMO_ONLY_PAGE_PREFIXES, MARKETING_PATH_PREFIXES } from "@/lib/config/production-routes";
import { SESSION_COOKIE_NAME } from "@/lib/security/session-cookie-name";
import { config, proxy } from "@/proxy";

/**
 * proxy.ts decides the HTTP status of production page requests before anything
 * renders (see lib/config/production-routes.ts for why a page cannot). It is a
 * convenience for scanners and load balancers, not the access control: every
 * page and route still goes through requireViewer, which is why a request that
 * merely CARRIES a credential is passed through without being validated here.
 *
 * Demo is untouched: the proxy passes every request on.
 */
afterEach(() => vi.unstubAllEnvs());

const asProduction = () => vi.stubEnv("JEEVES_MODE", undefined);
const asDemo = () => vi.stubEnv("JEEVES_MODE", "demo");

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://jeeves.example.com${path}`, { headers });
}
const passedThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

/**
 * Next runs every proxy response through its adapter, which parses the Location
 * header with `new URL(location)` (no base). A relative Location therefore
 * throws ERR_INVALID_URL there and the visitor gets a 500 instead of the
 * redirect. The proxy must hand Next an ABSOLUTE URL on the request's own
 * origin; the adapter then puts a relative Location on the wire for a same-host
 * redirect. scripts/smoke-production.ts checks the wire behaviour against a
 * real server; this pins the contract the adapter needs.
 */
function redirectTarget(response: Response): URL {
  const location = response.headers.get("location");
  expect(location, "a redirect must carry a Location header").not.toBeNull();
  return new URL(location!); // throws on a relative Location, exactly as Next's adapter does
}

describe("in production", () => {
  it("answers a signed-out console page with a 307 to /sign-in, not a 200", async () => {
    asProduction();
    for (const path of ["/inbox", "/portfolio", "/reviews", "/initiatives/new", "/agents/reviewer-privacy-hipaa"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(307);
      const target = redirectTarget(response);
      expect(target.origin, path).toBe("https://jeeves.example.com");
      expect(target.pathname + target.search, path).toBe("/sign-in");
    }
  });

  it("never lets a CDN keep a redirect it learned for a request without a cookie", async () => {
    asProduction();
    expect((await proxy(request("/inbox"))).headers.get("cache-control")).toBe("no-store");
  });

  it("answers '/' with a 307 to the console", async () => {
    asProduction();
    const response = await proxy(request("/"));
    expect(response.status).toBe(307);
    const target = redirectTarget(response);
    expect(target.origin).toBe("https://jeeves.example.com");
    expect(target.pathname + target.search).toBe("/inbox");
  });

  it("answers the marketing pages 404, not a 200 soft 404", async () => {
    asProduction();
    for (const path of ["/pilot", "/privacy", "/terms", "/thank-you", "/frameworks", "/frameworks/nist-ai-rmf"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers the operator page with the same bare 404", async () => {
    asProduction();
    const response = await proxy(request("/operator"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a console page through when the request carries a session cookie, valid or not", async () => {
    asProduction();
    const response = await proxy(request("/inbox", { cookie: `other=1; ${SESSION_COOKIE_NAME}=whatever` }));
    expect(passedThrough(response)).toBe(true);
  });

  it("passes a console page through when the request carries an Authorization header", async () => {
    asProduction();
    expect(passedThrough(await proxy(request("/inbox", { authorization: "Bearer t" })))).toBe(true);
  });

  it("is not fooled by a cookie that merely contains the session cookie's name", async () => {
    asProduction();
    const response = await proxy(request("/inbox", { cookie: `x_${SESSION_COOKIE_NAME}=1; ${SESSION_COOKIE_NAME}x=2` }));
    expect(response.status).toBe(307);
  });

  it("does not treat a jeeves_workspace cookie as a credential: it has no standing in production", async () => {
    asProduction();
    expect((await proxy(request("/inbox", { cookie: "jeeves_workspace=ws_abc.sig" }))).status).toBe(307);
  });

  it("leaves sign-in, the API and assets to their own handling", async () => {
    asProduction();
    for (const path of ["/sign-in", "/api/health", "/initiatives/x/detail-data", "/robots.txt"]) {
      expect(passedThrough(await proxy(request(path))), path).toBe(true);
    }
  });
});

describe("in demo", () => {
  it("passes every request on, unchanged", async () => {
    asDemo();
    for (const path of ["/", "/inbox", "/portfolio", "/pilot", "/frameworks/nist-ai-rmf", "/sign-in", "/api/session"]) {
      const response = await proxy(request(path));
      expect(passedThrough(response), path).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

// Next reads `matcher` statically, so it cannot be built from the lists. This is
// the drift guard between the two.
describe("the matcher", () => {
  const matcher = config.matcher as string[];

  it("is an array of literal path patterns", () => {
    expect(Array.isArray(matcher)).toBe(true);
    for (const pattern of matcher) expect(pattern).toMatch(/^\//);
  });

  it("matches '/' and every console, marketing and demo-only prefix, and nothing else", () => {
    const expected = ["/", ...[...CONSOLE_PATH_PREFIXES, ...MARKETING_PATH_PREFIXES, ...DEMO_ONLY_PAGE_PREFIXES].map((prefix) => `${prefix}/:path*`)];
    expect([...matcher].sort()).toEqual(expected.sort());
  });
});
