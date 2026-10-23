// Boot-time checks, run once per server start from instrumentation.ts.
//
// Kept out of instrumentation.ts itself so that file stays a thin, edge-safe
// shell: Next compiles it for the edge runtime too, and everything with Node
// or database dependencies belongs behind its `NEXT_RUNTIME === "nodejs"`
// guard in a dynamically imported module like this one.
import type { InstallationDb } from "../db/installation";
import { runtimeDatabaseUrl } from "../db/runtime-config";
import { resolveDataProviderMode } from "../data/provider-mode";
import { markBootFailed } from "./boot-state";
import { assertProductionConfig, deploymentMode, ProductionConfigError } from "./deployment-mode";
import { InstallationCheckError, verifyInstallation } from "./installation-check";

export interface BootCheckDeps {
  /** Environment to check. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Process exit. Injectable so tests never kill the runner. Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Error sink. Defaults to console.error. */
  log?: (...args: unknown[]) => void;
  /**
   * Database handle for the installation check. Defaults to the process-wide
   * handle from lib/db/client, imported lazily so a boot that never reaches the
   * check (invalid configuration, mock data) never loads a database driver.
   * Injectable so tests never open a real database.
   */
  getDb?: () => InstallationDb | Promise<InstallationDb>;
}

async function defaultGetDb(): Promise<InstallationDb> {
  return (await import("../db/client")).getDb();
}

/**
 * Errors from the database layer can carry the connection string (a refused
 * connection that names its target, a malformed URL). The boot log is the one
 * place those errors surface, so the configured URL is cut out of the message.
 */
function describeError(err: unknown, env: Record<string, string | undefined>): string {
  const message = err instanceof Error ? err.message : "unknown error";
  const url = runtimeDatabaseUrl(env);
  return url ? message.split(url).join("[database url]") : message;
}

/**
 * Run the checks that decide whether this server may start.
 *
 * 1. Production: the configuration is validated (assertProductionConfig).
 * 2. The installation stamp is verified against the database
 *    (verifyInstallation): production requires a 'production' stamp and a
 *    database free of demo data; demo stamps an unstamped database 'demo' in
 *    place (the live demo database predates the stamp and cannot be reseeded)
 *    and refuses a 'production' one.
 *
 * On any failure the error is logged (variable names and counts only, never
 * values), the process-wide boot-failed flag is set (so /api/health answers 503
 * even if the exit does not take), and the process exits with code 1. The flag
 * is set BEFORE the exit for that reason.
 *
 * Demo with mock data (DATA_PROVIDER=mock, or no database URL and no explicit
 * provider) has no database in play, so there is nothing to stamp or verify and
 * the demo boots exactly as it always has. A demo database that has not run
 * migration 0015 yet also keeps booting, with a warning: it cannot be a
 * production install, so there is no stamp to protect, and a deploy that
 * outruns its migration must not take the demo down.
 *
 * Further boot-time checks belong here, inside the same fail-closed handling.
 */
export async function runBootChecks(deps: BootCheckDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args));
  const getDb = deps.getDb ?? defaultGetDb;
  const mode = deploymentMode(env);

  const fail = (reason: string): void => {
    log(`[boot] ${reason}`);
    log("[boot] refusing to start; exiting.");
    markBootFailed(reason);
    exit(1);
  };

  if (mode === "production") {
    try {
      assertProductionConfig(env);
    } catch (err) {
      fail(
        err instanceof ProductionConfigError
          ? `production configuration is invalid: ${err.problems.join("; ")}`
          : `production boot check failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      // An invalid configuration may name no database at all; never go on to open one.
      return;
    }
  } else if (resolveDataProviderMode(env.DATA_PROVIDER, !!runtimeDatabaseUrl(env)) === "mock") {
    return;
  }

  try {
    await verifyInstallation(await getDb(), mode);
  } catch (err) {
    if (mode === "demo" && err instanceof InstallationCheckError && err.code === "not_migrated") {
      log(`[boot] ${err.message} Continuing without an installation stamp.`);
      return;
    }
    fail(
      err instanceof InstallationCheckError
        ? `installation check failed: ${err.message}`
        : `installation check failed: could not read the installation stamp: ${describeError(err, env)}`,
    );
  }
}
