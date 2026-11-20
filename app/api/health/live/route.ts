/**
 * GET /api/health/live — container liveness probe.
 *
 * Answers from the process alone and never touches the database, so a short
 * database outage fails readiness (/api/health, which takes the instance out
 * of the load balancer) without making the orchestrator replace healthy
 * containers. Only a failed boot (lib/config/boot-state.ts) makes it 503: that
 * server must not stay up even if the process.exit that follows did not take.
 *
 * Unauthenticated and opaque like /api/health, and reachable in every mode
 * (the production proxy only redirects console and marketing pages).
 *
 * 200: { status: "live" }
 * 503: { status: "boot_failed" }
 */
import { bootFailure } from "@/lib/config/boot-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "cache-control": "no-store, max-age=0" } as const;

export async function GET(): Promise<Response> {
  if (bootFailure() !== null) {
    return Response.json({ status: "boot_failed" }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ status: "live" }, { status: 200, headers: NO_STORE });
}
