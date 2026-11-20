// A bounded drain on SIGTERM.
//
// Next's standalone server already closes its listener on SIGTERM and then
// waits for in-flight requests with no limit, so one slow client (an
// unauthenticated upload trickling in) holds a stopping task until the
// orchestrator's SIGKILL, which also cuts off real requests. This adds only the
// deadline: 125 s after SIGTERM the process exits. The platform's stop timeout
// must be longer (130 s, see docs/deploy.md) or it kills the process first.

export const SHUTDOWN_DEADLINE_MS = 125_000;

interface SignalSource {
  on(signal: "SIGTERM", handler: () => void): unknown;
}

export interface ShutdownDeps {
  proc?: SignalSource;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  setTimer?: (handler: () => void, ms: number) => NodeJS.Timeout;
}

let installed = false;

export function resetShutdownDeadlineForTests(): void {
  installed = false;
}

/** Idempotent: instrumentation's register() may run more than once per process in tests. */
export function installShutdownDeadline(deps: ShutdownDeps = {}): void {
  if (installed) return;
  installed = true;
  const proc = deps.proc ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((message: string) => console.error(message));
  const setTimer = deps.setTimer ?? setTimeout;
  let armed = false;

  proc.on("SIGTERM", () => {
    if (armed) return;
    armed = true;
    // unref: when the server drains and exits on its own, this timer must not hold the process open.
    setTimer(() => {
      log(`[shutdown] requests still open ${SHUTDOWN_DEADLINE_MS / 1000} s after SIGTERM; exiting.`);
      exit(0);
    }, SHUTDOWN_DEADLINE_MS).unref();
  });
}
