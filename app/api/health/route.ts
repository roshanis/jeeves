/**
 * GET /api/health — container liveness/readiness probe.
 *
 * A container that is "running" but cannot reach Postgres is not healthy, so
 * this does a trivial round-trip (`select 1`) rather than just returning 200
 * because the process is alive. Used by the healthcheck in
 * deploy/podman/Containerfile and by the compose/Quadlet units.
 *
 * This endpoint is UNAUTHENTICATED by necessity — a probe has no session — so
 * it deliberately reveals nothing: no version, no hostname, no driver, and in
 * particular no error text from the database, since a connection failure
 * usually carries the host, port and sometimes the user. Callers get a status
 * word and nothing else; the real error goes to the server log where an
 * operator can see it.
 *
 * Distinct from POST /api/agents/health, which is a session-gated probe of
 * the LLM connector and can cost a real API call.
 *
 * 200: { status: "ok",          database: "ok" }
 * 503: { status: "degraded",    database: "unreachable" }
 * 503: { status: "boot_failed" }
 *
 * `boot_failed` means instrumentation.ts refused to start this server (an
 * invalid production configuration, lib/config/boot-checks.ts). It is checked
 * first and never touches the database: a server that failed its boot checks
 * must not be routed to even if the database is healthy, and even if the
 * process.exit that normally follows did not take effect. The reason stays in
 * the server log.
 */
import { sql } from "drizzle-orm";
import { bootFailure } from "@/lib/config/boot-state";
import { getDb } from "@/lib/db/client";

// Never cached or prerendered: a stale 200 would keep a broken instance in
// the load balancer.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "cache-control": "no-store, max-age=0" } as const;

export async function GET(): Promise<Response> {
  if (bootFailure() !== null) {
    return Response.json({ status: "boot_failed" }, { status: 503, headers: NO_STORE });
  }
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", database: "ok" }, { status: 200, headers: NO_STORE });
  } catch (err) {
    // Server-side only. The response body stays opaque.
    console.error("[health] database probe failed:", err);
    return Response.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
