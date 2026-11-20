// HTTP face of the demo's installation gate (lib/config/boot-state.ts).
//
// While the gate is closed (a demo that could not reach its database at boot
// and has not verified the installation stamp since) every database-backed
// route handler answers a short 503 with Retry-After before it does anything
// else, and the console shell shows a notice instead of its pages. getDb()
// (lib/db/client.ts) is the real barrier: it throws while the gate is closed,
// so a handler or page that is missed here still cannot read or write.
//
// Each call also starts the due recheck, handed to after() so a serverless
// function stays alive for it. A visitor never waits on it.
import { after } from "next/server";
import { DEMO_RECHECK_INTERVAL_MS, installationGateClosed, requestInstallationRecheck } from "../config/boot-state";

export const DATABASE_UNAVAILABLE_MESSAGE =
  "Demo storage is temporarily unavailable. Please try again shortly.";

/** The recheck interval: asking sooner cannot get a different answer. */
export const RETRY_AFTER_SECONDS = Math.ceil(DEMO_RECHECK_INTERVAL_MS / 1000);

/** Start the recheck when one is due. after() throws outside a request scope; the recheck still runs. */
export function scheduleInstallationRecheck(): void {
  const recheck = requestInstallationRecheck();
  if (!recheck) return;
  try {
    after(recheck);
  } catch {
    // Not in a request scope (a test, a script): the promise runs regardless.
  }
}

/**
 * null when the database may be used; otherwise the 503 a route handler
 * returns as its first statement: `const unavailable = databaseNotReady();
 * if (unavailable) return unavailable;`.
 */
export function databaseNotReady(): Response | null {
  if (!installationGateClosed()) return null;
  scheduleInstallationRecheck();
  return Response.json(
    { error: DATABASE_UNAVAILABLE_MESSAGE, code: "DEMO_STORAGE_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(RETRY_AFTER_SECONDS) } },
  );
}

/** For the console layout: false while the database is not available. */
export function consoleDatabaseReady(): boolean {
  if (!installationGateClosed()) return true;
  scheduleInstallationRecheck();
  return false;
}
