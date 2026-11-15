// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_PATH_PREFIXES,
  MARKETING_PATH_PREFIXES,
  classifyPath,
  productionRouteDecision,
} from "./production-routes";

/**
 * Production pages answer the right HTTP status.
 *
 * Next streams a page behind its loading.tsx boundary, so a redirect() or
 * notFound() thrown while the page renders arrives AFTER the status line: a
 * signed-out request for /inbox got HTTP 200 with a meta-refresh to /sign-in,
 * and a production 404 for /pilot was a 200 "soft 404". Nothing leaked (the
 * data sits behind requireViewer), but a scanner, a load balancer or a security
 * reviewer reads the status line. proxy.ts decides it before anything renders;
 * this is the decision it makes.
 */
afterEach(() => vi.unstubAllEnvs());

const asProduction = () => vi.stubEnv("JEEVES_MODE", undefined);
const asDemo = () => vi.stubEnv("JEEVES_MODE", "demo");

describe("classifyPath", () => {
  it.each([
    "/inbox",
    "/inbox/",
    "/portfolio",
    "/reviews",
    "/agents",
    "/agents/reviewer-privacy-hipaa",
    "/monitoring",
    "/controls",
    "/audit",
    "/promotions",
    "/admin",
    "/initiatives/new",
    "/initiatives/member-chat-copilot",
  ])("%s is a console page", (path) => {
    expect(classifyPath(path)).toBe("console");
  });

  it.each(["/pilot", "/privacy", "/terms", "/thank-you", "/frameworks", "/frameworks/nist-ai-rmf"])(
    "%s is a marketing page",
    (path) => {
      expect(classifyPath(path)).toBe("marketing");
    },
  );

  it("is '/' for the landing page", () => {
    expect(classifyPath("/")).toBe("home");
  });

  it.each([
    "/sign-in",
    "/operator",
    "/api/health",
    "/api/initiatives",
    "/robots.txt",
    "/_next/static/chunks/x.js",
    "/inboxes",
    "/administrator",
    "/pilots",
    "/frameworks-extra",
  ])("%s is left alone (a route handler, an asset or a different path)", (path) => {
    expect(classifyPath(path)).toBe("other");
  });

  // A route handler under a console path answers 401 JSON itself; a browser
  // redirect would hand an API client an HTML sign-in page instead.
  it("leaves the initiative detail-data route handler to its own 401", () => {
    expect(classifyPath("/initiatives/member-chat-copilot/detail-data")).toBe("other");
  });
});

describe("productionRouteDecision", () => {
  it("does nothing in demo, for every path, with or without a credential", () => {
    asDemo();
    for (const path of ["/", "/inbox", "/portfolio", "/initiatives/x", "/pilot", "/frameworks/nist-ai-rmf", "/api/health"]) {
      for (const hasCredential of [false, true]) {
        expect(productionRouteDecision(path, hasCredential)).toEqual({ kind: "next" });
      }
    }
  });

  describe("in production", () => {
    it("redirects a console page with no credential to /sign-in", () => {
      asProduction();
      expect(productionRouteDecision("/inbox", false)).toEqual({ kind: "redirect", to: "/sign-in" });
      expect(productionRouteDecision("/initiatives/abc", false)).toEqual({ kind: "redirect", to: "/sign-in" });
    });

    it("lets a console page through when a credential is present: the page decides if it is valid", () => {
      asProduction();
      expect(productionRouteDecision("/inbox", true)).toEqual({ kind: "next" });
    });

    it("answers a marketing page 404 whether or not a credential is present", () => {
      asProduction();
      expect(productionRouteDecision("/pilot", false)).toEqual({ kind: "not-found" });
      expect(productionRouteDecision("/frameworks/eu-ai-act", true)).toEqual({ kind: "not-found" });
    });

    it("sends '/' to the console, as the landing page itself does", () => {
      asProduction();
      expect(productionRouteDecision("/", false)).toEqual({ kind: "redirect", to: "/inbox" });
      expect(productionRouteDecision("/", true)).toEqual({ kind: "redirect", to: "/inbox" });
    });

    it("leaves everything else alone, including sign-in itself", () => {
      asProduction();
      for (const path of ["/sign-in", "/api/health", "/api/initiatives", "/initiatives/x/detail-data", "/operator"]) {
        expect(productionRouteDecision(path, false)).toEqual({ kind: "next" });
      }
    });

    it("treats a mistyped mode as production", () => {
      vi.stubEnv("JEEVES_MODE", "Demo");
      expect(productionRouteDecision("/inbox", false)).toEqual({ kind: "redirect", to: "/sign-in" });
    });
  });
});

// The lists are the contract: a page added tomorrow without a place in them
// would answer 200 to a signed-out request again.
describe("the path lists cover the route tree", () => {
  const APP_DIR = join(process.cwd(), "app");

  /** Top-level URL segments of the pages under one route group. */
  function segments(group: string): string[] {
    const dir = join(APP_DIR, group);
    return readdirSync(dir)
      .filter((entry) => statSync(join(dir, entry)).isDirectory() && !entry.startsWith("_") && entry !== "__tests__")
      .map((entry) => `/${entry}`)
      .sort();
  }

  it("lists every top-level directory of the (console) group", () => {
    expect([...CONSOLE_PATH_PREFIXES].sort()).toEqual(segments("(console)"));
  });

  it("lists every top-level directory of the (marketing) group", () => {
    expect([...MARKETING_PATH_PREFIXES].sort()).toEqual(segments("(marketing)"));
  });
});
