// Process-wide "this server failed to boot" flag.
//
// instrumentation.ts register() runs the production configuration check once
// at server start. On failure it logs, calls markBootFailed() and exits the
// process. The exit is the primary control, but nothing guarantees it takes
// effect in every host (a wrapper that restarts into the same config, a
// platform that catches the exit, a test double), and it is not verified that
// an exception thrown from register() stops a Next server at all. So the flag
// is the fail-closed backstop: /api/health reports 503 `boot_failed` for as
// long as it is set, and later slices make requireViewer() refuse requests.
//
// Server-only state; it is never sent to the client and never exposed through
// a NEXT_PUBLIC_ variable. The reason is for the server log, not for
// responses: unauthenticated callers only ever see the status word.
//
// Kept on globalThis, not in a module variable, for the same reason as the DB
// handle in lib/db/client.ts: Next evaluates instrumentation.ts and the route
// handlers in separate module graphs, and a per-module flag set by register()
// would be invisible to /api/health.
const BOOT_FAILURE_KEY = Symbol.for("jeeves.boot.failure");

type BootStateSlot = { reason: string | null };

function slot(): BootStateSlot {
  const g = globalThis as Record<symbol, unknown>;
  return (g[BOOT_FAILURE_KEY] ??= { reason: null }) as BootStateSlot;
}

/**
 * Record that boot failed. One-way: the first reason wins and nothing but
 * resetBootStateForTests() clears it. A blank reason still counts as a
 * failure, so a caller cannot accidentally "fail" without failing closed.
 */
export function markBootFailed(reason: string): void {
  const state = slot();
  state.reason ??= reason || "boot failed";
}

/** The recorded failure reason, or null when boot has not failed. */
export function bootFailure(): string | null {
  return slot().reason;
}

/** Test-only: clear the flag between cases. Production code never calls this. */
export function resetBootStateForTests(): void {
  slot().reason = null;
}
