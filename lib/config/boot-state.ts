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
// The same module holds the demo's INSTALLATION GATE. A demo whose database
// cannot be reached at boot does not exit (the static pages need no data); it
// closes the gate instead. While the gate is closed getDb() (lib/db/client.ts)
// throws, so nothing reads or writes a database that was never verified in this
// process, and database-backed routes answer 503 (lib/http/database-gate.ts).
// Production never closes it. The gate is reopened by a bounded, single-flight
// recheck that a request starts but never waits for.
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
  const state = gate();
  state.closed = false;
  state.recheck = null;
  state.inFlight = false;
  state.lastAttemptAt = null;
}

const GATE_KEY = Symbol.for("jeeves.boot.installationGate");

/** Least time between two rechecks of an unverified installation. */
export const DEMO_RECHECK_INTERVAL_MS = 15_000;

type GateSlot = {
  closed: boolean;
  recheck: (() => Promise<void>) | null;
  inFlight: boolean;
  lastAttemptAt: number | null;
};

function gate(): GateSlot {
  const g = globalThis as Record<symbol, unknown>;
  return (g[GATE_KEY] ??= { closed: false, recheck: null, inFlight: false, lastAttemptAt: null }) as GateSlot;
}

/** Demo only: nothing may open the database until the installation check has passed. */
export function closeInstallationGate(): void {
  gate().closed = true;
}

/** The installation check passed (or the database predates the stamp): data may flow. */
export function openInstallationGate(): void {
  const state = gate();
  state.closed = false;
  state.recheck = null;
}

export function installationGateClosed(): boolean {
  return gate().closed;
}

/** Register the check to run again while the gate is closed; `now` is when the last attempt ended. */
export function setInstallationRecheck(recheck: () => Promise<void>, now: number = Date.now()): void {
  const state = gate();
  state.recheck = recheck;
  state.lastAttemptAt = now;
}

/**
 * Start the registered recheck when the gate is closed, none is running and the
 * interval has passed. Returns the running promise (it never rejects) or null.
 * Callers hand it to after() and never await it: a visitor never waits on it.
 */
export function requestInstallationRecheck(now: number = Date.now()): Promise<void> | null {
  const state = gate();
  if (!state.closed || !state.recheck || state.inFlight) return null;
  if (state.lastAttemptAt !== null && now - state.lastAttemptAt < DEMO_RECHECK_INTERVAL_MS) return null;
  state.inFlight = true;
  state.lastAttemptAt = now;
  const run = state.recheck;
  return (async () => {
    try {
      await run();
    } catch {
      // The recheck logs for itself; a failed attempt leaves the gate closed.
    } finally {
      state.inFlight = false;
    }
  })();
}
