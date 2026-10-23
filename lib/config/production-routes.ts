// Which production page requests get a redirect or a 404 before anything
// renders, decided by proxy.ts.
//
// Why a page cannot do this itself: every console page is wrapped in
// app/(console)/loading.tsx, so Next streams the response behind that boundary
// and the status line is on the wire (200) before the page runs. A redirect()
// or notFound() thrown by the page then reaches the browser as a meta-refresh or
// a "soft 404" inside a 200. Nothing leaks, because the data sits behind
// requireViewer, but scanners, load balancers and security reviewers read the
// status line.
//
// This is a convenience, not the access control. It only turns away a request
// that carries no credential at all; whether a credential is VALID is
// requireViewer's call, next to the data, where no matcher can miss a route.
//
// Import-free of the database layer on purpose: proxy.ts bundles this.
import { isProductionMode } from "./deployment-mode";

/** Where a request with no credential is sent. */
export const SIGN_IN_PATH = "/sign-in";

/** Where "/" sends a production visitor: the console, which sends them on to sign-in. */
export const CONSOLE_HOME = "/inbox";

/**
 * The top-level URL segments of app/(console) and app/(marketing). The
 * production-routes test checks both lists against the route tree, and
 * tests/deploy/proxy.test.ts checks the matcher in proxy.ts against them, so a
 * page added without a place here fails a test instead of answering 200 to a
 * signed-out request.
 */
export const CONSOLE_PATH_PREFIXES = [
  "/admin",
  "/agents",
  "/audit",
  "/controls",
  "/inbox",
  "/initiatives",
  "/monitoring",
  "/portfolio",
  "/promotions",
  "/reviews",
] as const;

export const MARKETING_PATH_PREFIXES = ["/frameworks", "/pilot", "/privacy", "/terms", "/thank-you"] as const;

export type PathClass = "console" | "marketing" | "home" | "other";

/** `/initiatives/<slug>/detail-data` is a route handler: it answers 401 JSON itself. */
const ROUTE_HANDLER_UNDER_CONSOLE = /^\/initiatives\/[^/]+\/detail-data\/?$/;

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyPath(pathname: string): PathClass {
  if (pathname === "/") return "home";
  if (ROUTE_HANDLER_UNDER_CONSOLE.test(pathname)) return "other";
  if (CONSOLE_PATH_PREFIXES.some((prefix) => under(pathname, prefix))) return "console";
  if (MARKETING_PATH_PREFIXES.some((prefix) => under(pathname, prefix))) return "marketing";
  return "other";
}

export type RouteDecision =
  | { kind: "next" }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

/**
 * Demo: always `next`, so the proxy changes nothing there.
 *
 * Production:
 *  - "/" redirects to the console (what the landing page does itself);
 *  - a marketing page is a 404 (a production install has none);
 *  - a console page with no credential redirects to sign-in; with one it goes
 *    through, and the page decides whether the credential is valid;
 *  - everything else (sign-in, the API, assets) is left to its own handling.
 */
export function productionRouteDecision(pathname: string, hasCredential: boolean): RouteDecision {
  if (!isProductionMode()) return { kind: "next" };
  switch (classifyPath(pathname)) {
    case "home":
      return { kind: "redirect", to: CONSOLE_HOME };
    case "marketing":
      return { kind: "not-found" };
    case "console":
      return hasCredential ? { kind: "next" } : { kind: "redirect", to: SIGN_IN_PATH };
    case "other":
      return { kind: "next" };
  }
}
