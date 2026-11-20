// Next.js proxy (formerly middleware): gives production page requests the HTTP
// status a scanner or load balancer expects (a 307 to sign-in, a 404) before
// anything renders. See lib/config/production-routes.ts for the decision and
// for why a page cannot make it. In demo it passes every request on.
//
// A convenience only: it checks that a credential is PRESENT, never that it is
// valid. Access control is requireViewer (lib/services/require-viewer.ts),
// beside the data, which is why a route this matcher forgot is still gated.
import { NextResponse, type NextRequest } from "next/server";
import { productionRouteDecision } from "./lib/config/production-routes";
import { SESSION_COOKIE_NAME } from "./lib/security/session-cookie-name";

// Never let a CDN keep a status it learned for a request without a cookie.
const NO_STORE = { "Cache-Control": "no-store" };

export function proxy(request: NextRequest): NextResponse {
  const hasCredential =
    !!request.cookies.get(SESSION_COOKIE_NAME)?.value || !!request.headers.get("authorization");
  const decision = productionRouteDecision(request.nextUrl.pathname, hasCredential);

  switch (decision.kind) {
    case "redirect":
      // An ABSOLUTE URL on the request's own origin. Next runs this response through
      // its proxy adapter, which parses Location with `new URL(location)` and throws on
      // a relative value: the visitor then gets a 500, not the redirect. For a same-host
      // redirect the adapter rewrites Location back to a relative path before it reaches
      // the wire, so the origin Next believes it is served from (which can be wrong
      // behind a load balancer) never leaves the process.
      return NextResponse.redirect(new URL(decision.to, request.url), { status: 307, headers: NO_STORE });
    case "not-found":
      return new NextResponse(null, { status: 404, headers: NO_STORE });
    case "next":
      return NextResponse.next();
  }
}

// Next reads the matcher statically, so it is written out rather than built
// from the path lists; tests/deploy/proxy.test.ts keeps the two in step.
export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/agents/:path*",
    "/audit/:path*",
    "/controls/:path*",
    "/inbox/:path*",
    "/initiatives/:path*",
    "/monitoring/:path*",
    "/operator/:path*",
    "/portfolio/:path*",
    "/promotions/:path*",
    "/reviews/:path*",
    "/frameworks/:path*",
    "/pilot/:path*",
    "/privacy/:path*",
    "/terms/:path*",
    "/thank-you/:path*",
  ],
};
