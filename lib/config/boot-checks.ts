// Boot-time checks, run once per server start from instrumentation.ts.
//
// Kept out of instrumentation.ts itself so that file stays a thin, edge-safe
// shell: Next compiles it for the edge runtime too, and everything with Node
// or database dependencies belongs behind its `NEXT_RUNTIME === "nodejs"`
// guard in a dynamically imported module like this one.
import type { InstallationDb } from "../db/installation";
import { runtimeDatabaseUrl } from "../db/runtime-config";
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
  /** Wait between demo retries. Injectable so tests never sleep. Defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits between the attempts of a demo boot's installation check: three
 * attempts over about five seconds. On Vercel every cold start does three
 * database calls before serving, and a brief Neon error (a compute waking from
 * suspend, a dropped connection) must not take the instance down. Production
 * does not retry: a database it cannot read is not one it may serve from.
 */
export const DEMO_CHECK_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000];

async function defaultGetDb(): Promise<InstallationDb> {
  return (await import("../db/client")).getDb();
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Demo with no database in play (no DATABASE_URL or POSTGRES_URL, and the
 * provider is not explicitly `db`) has nothing to stamp or verify and boots
 * exactly as it always has. A configured database is in play even under
 * DATA_PROVIDER=mock: several routes (/api/exceptions, /api/monitor/incidents,
 * /api/health, the review notification queue) call getDb() whatever the
 * provider says, so the stamp is verified in every other case. A demo database
 * that has not run migration 0015 yet keeps booting, with a warning: it cannot
 * be a production install, so there is no stamp to protect, and a deploy that
 * outruns its migration must not take the demo down.
 *
 * In demo, a database ERROR (unreachable, timed out) is retried with a short
 * backoff before it fails the boot (DEMO_CHECK_RETRY_DELAYS_MS). A stamp
 * mismatch is an answer, not an error: it is never retried and fails at once.
 *
 * Further boot-time checks belong here, inside the same fail-closed handling.
 */
export async function runBootChecks(deps: BootCheckDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args));
  const getDb = deps.getDb ?? defaultGetDb;
  const sleep = deps.sleep ?? defaultSleep;
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
  } else if (!runtimeDatabaseUrl(env) && env.DATA_PROVIDER !== "db") {
    return;
  }

  const delays = mode === "demo" ? DEMO_CHECK_RETRY_DELAYS_MS : [];
  for (let attempt = 0; ; attempt++) {
    try {
      await verifyInstallation(await getDb(), mode);
      return;
    } catch (err) {
      if (err instanceof InstallationCheckError) {
        if (mode === "demo" && err.code === "not_migrated") {
          log(`[boot] ${err.message} Continuing without an installation stamp.`);
          return;
        }
        fail(`installation check failed: ${err.message}`);
        return;
      }
      if (attempt < delays.length) {
        log(
          `[boot] installation check could not read the database (attempt ${attempt + 1} of ${delays.length + 1}): ` +
            `${describeError(err, env)}; retrying in ${delays[attempt]} ms.`,
        );
        await sleep(delays[attempt]);
        continue;
      }
      fail(`installation check failed: could not read the installation stamp: ${describeError(err, env)}`);
      return;
    }
  }
}
