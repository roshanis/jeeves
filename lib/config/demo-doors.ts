// The demo-only doors: persona sessions, public sessions, the operator queue
// and the synthetic-telemetry monitor. They exist for the public demo, and a
// production install has none of them (see lib/config/deployment-mode.ts).
//
// Two ways to keep them shut:
//  - the HTTP surface answers a bare 404 (demoDoorClosed, demoDoorFallbacks),
//    and does so FIRST: before parsing a body, spending a rate-limit token or
//    checking a secret, so there is no 401/405/429/503 to tell it apart from a
//    route that was never built;
//  - code reached some other way refuses (assertDemoMode), as defence in depth
//    for a caller that skips the route.
import { isProductionMode } from "./deployment-mode";

/**
 * Thrown when demo-only code runs in production. Names the door, never a
 * configured value: it can end up in a log aggregator.
 */
export class DemoOnlyError extends Error {
  readonly door: string;

  constructor(door: string) {
    super(`${door} is demo-only and not available in production mode`);
    this.name = "DemoOnlyError";
    this.door = door;
  }
}

/** Throws a DemoOnlyError in production; returns in demo. */
export function assertDemoMode(door: string): void {
  if (isProductionMode()) throw new DemoOnlyError(door);
}

/**
 * A bare 404 in production, null in demo. Route handlers start with
 * `const closed = demoDoorClosed(); if (closed) return closed;`.
 *
 * No body (Next's own notFound() in a route handler is the same) and
 * no-store, so a CDN never keeps a 404 it learned while the mode was wrong.
 */
export function demoDoorClosed(): Response | null {
  return isProductionMode()
    ? new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } })
    : null;
}

const HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** HEAD is derived from GET by Next, so a GET route has no HEAD to cover. */
type Covered<M extends HttpMethod> = M | (M extends "GET" ? "HEAD" : never);

export type DemoDoorFallbacks<M extends HttpMethod> = Omit<
  Record<HttpMethod, (req: Request) => Response>,
  Covered<M>
>;

/**
 * Handlers for every method a demo-only route does NOT implement.
 *
 * Without them Next answers the missing methods itself (405, and a 204 with an
 * Allow header for OPTIONS), which tells a scanner the path exists even though
 * the route's own handler answers 404 in production. In demo these reproduce
 * Next's defaults exactly (empty 405; OPTIONS 204 listing the allowed
 * methods), so demo behaviour does not change.
 *
 *   export const { GET, HEAD, PUT, PATCH, DELETE, OPTIONS } = demoDoorFallbacks("POST");
 */
export function demoDoorFallbacks<M extends HttpMethod>(implemented: M): DemoDoorFallbacks<M> {
  const own = new Set<HttpMethod>([implemented]);
  if (implemented === "GET") own.add("HEAD");
  const allow = [...own, "OPTIONS"].sort().join(", ");

  const handlers: Partial<Record<HttpMethod, (req: Request) => Response>> = {};
  for (const method of HTTP_METHODS) {
    if (own.has(method)) continue;
    handlers[method] =
      method === "OPTIONS"
        ? () => demoDoorClosed() ?? new Response(null, { status: 204, headers: { Allow: allow } })
        : () => demoDoorClosed() ?? new Response(null, { status: 405 });
  }
  return handlers as DemoDoorFallbacks<M>;
}
