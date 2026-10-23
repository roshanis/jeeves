// Boot-time checks, run once per server start from instrumentation.ts.
//
// Kept out of instrumentation.ts itself so that file stays a thin, edge-safe
// shell: Next compiles it for the edge runtime too, and everything with Node
// or database dependencies belongs behind its `NEXT_RUNTIME === "nodejs"`
// guard in a dynamically imported module like this one.
import { markBootFailed } from "./boot-state";
import { assertProductionConfig, deploymentMode, ProductionConfigError } from "./deployment-mode";

export interface BootCheckDeps {
  /** Environment to check. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Process exit. Injectable so tests never kill the runner. Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Error sink. Defaults to console.error. */
  log?: (...args: unknown[]) => void;
}

/**
 * Run the checks that decide whether this server may start.
 *
 * Production: the configuration is validated (assertProductionConfig). On any
 * failure the error is logged (variable names only, never values), the
 * process-wide boot-failed flag is set (so /api/health answers 503 even if
 * the exit does not take), and the process exits with code 1. The flag is set
 * BEFORE the exit for that reason.
 *
 * Demo: nothing changes; the demo keeps booting exactly as it always has.
 *
 * This is the hook point for further boot-time checks: the installation-stamp
 * check (production) and the idempotent demo bootstrap (demo) are added here,
 * inside the same fail-closed handling.
 */
export async function runBootChecks(deps: BootCheckDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args));

  if (deploymentMode(env) === "demo") return;

  try {
    assertProductionConfig(env);
  } catch (err) {
    const reason =
      err instanceof ProductionConfigError
        ? `production configuration is invalid: ${err.problems.join("; ")}`
        : `production boot check failed: ${err instanceof Error ? err.message : "unknown error"}`;
    log(`[boot] ${reason}`);
    log("[boot] refusing to start; exiting.");
    markBootFailed(reason);
    exit(1);
  }
}
