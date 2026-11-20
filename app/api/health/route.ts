/**
 * GET /api/health — readiness probe for the load balancer.
 *
 * Liveness (container health check, restart decisions) is /api/health/live,
 * which never touches the database: a short database outage must take
 * instances out of rotation, not get them restarted.
 *
 * A container that is "running" but cannot reach Postgres is not healthy, so
 * this does a trivial round-trip (`select 1`) rather than just returning 200
 * because the process is alive. Used by the healthcheck in
 * the load balancer's target-group check.
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
 * A demo whose database could not be reached at boot (lib/config/boot-state.ts,
 * the installation gate) answers the degraded 503 with a Retry-After, without
 * touching the database: it serves its static pages but is not ready for data.
 *
 * `boot_failed` means instrumentation.ts refused to start this server (an
 * invalid production configuration, lib/config/boot-checks.ts). It is checked
 * first and never touches the database: a server that failed its boot checks
 * must not be routed to even if the database is healthy, and even if the
 * process.exit that normally follows did not take effect. The reason stays in
 * the server log.
 */
import { sql } from "drizzle-orm";
import { bootFailure, installationGateClosed } from "@/lib/config/boot-state";
import { safeDriverCode } from "@/lib/db/driver-error";
import { getDb } from "@/lib/db/client";
import { RETRY_AFTER_SECONDS, scheduleInstallationRecheck } from "@/lib/http/database-gate";

// Never cached or prerendered: a stale 200 would keep a broken instance in
// the load balancer.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Bound the probe so a saturated pool answers 503 inside a typical 5 s probe
// timeout instead of queueing behind page queries.
const PROBE_TIMEOUT_MS = 2000;

const NO_STORE = { "cache-control": "no-store, max-age=0" } as const;

export async function GET(): Promise<Response> {
  if (bootFailure() !== null) {
    return Response.json({ status: "boot_failed" }, { status: 503, headers: NO_STORE });
  }
  if (installationGateClosed()) {
    scheduleInstallationRecheck();
    return Response.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: { ...NO_STORE, "retry-after": String(RETRY_AFTER_SECONDS) } },
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("health probe timed out")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return Response.json({ status: "ok", database: "ok" }, { status: 200, headers: NO_STORE });
  } catch (err) {
    // Server-side only. The response body stays opaque.
    // One line with the allow-listed driver code: the error object carries the
    // query, the cause chain and a stack, per probe per task.
    const code = safeDriverCode(err);
    console.error(`[health] database probe failed${code ? ` (${code})` : err instanceof Error && err.message === "health probe timed out" ? " (timeout)" : ""}`);
    return Response.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    clearTimeout(timer);
  }
}
