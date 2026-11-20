// Boot-time checks, run once per server start from instrumentation.ts.
//
// Kept out of instrumentation.ts itself so that file stays a thin, edge-safe
// shell: Next compiles it for the edge runtime too, and everything with Node
// or database dependencies belongs behind its `NEXT_RUNTIME === "nodejs"`
// guard in a dynamically imported module like this one.
import type { InstallationDb } from "../db/installation";
import { BootDeadlineError, isConnectionClassError, safeDriverCode } from "../db/driver-error";
import { runtimeDatabaseUrl } from "../db/runtime-config";
import { closeInstallationGate, markBootFailed, openInstallationGate, setInstallationRecheck } from "./boot-state";
import { assertProductionConfig, deploymentMode, ProductionConfigError, trustedProxyHopsState } from "./deployment-mode";
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
 * attempts, 5 s of waiting plus up to 3 x DEMO_BOOT_ATTEMPT_DEADLINE_MS of
 * attempts, so about 14 s in the worst case. On Vercel every cold start does three
 * database calls before serving, and a brief Neon error (a compute waking from
 * suspend, a dropped connection) must not take the instance down. Production retries
 * connection-class errors only, see PRODUCTION_CHECK_RETRY_DELAYS_MS.
 */
export const DEMO_CHECK_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000];

/**
 * Waits between the attempts of a production boot's installation check: about
 * five seconds in total, and only for connection-class errors (a database that
 * is restarting or failing over). Without it every replacement task exits at
 * once during a short outage and the orchestrator's restart back-off outlasts
 * it. A stamp mismatch, a missing migration or any other error is an answer
 * and still stops the boot at once.
 */
export const PRODUCTION_CHECK_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 2_000];

/**
 * One attempt of a boot check may take this long before it counts as
 * "the database cannot be reached". Without it a hanging endpoint costs three
 * 10 s connect timeouts inside register(), before any page is served.
 */
export const DEMO_BOOT_ATTEMPT_DEADLINE_MS = 3_000;

/** A recheck of an unverified demo installation is abandoned after this long. */
export const DEMO_RECHECK_DEADLINE_MS = 20_000;

// getDb() refuses while the demo's installation gate is closed, and the check
// is what opens it: it uses the one handle that bypasses the gate.
async function defaultGetDb(): Promise<InstallationDb> {
  return (await import("../db/client")).getDbForInstallationCheck();
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BootDeadlineError(ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors from the database layer can carry the connection string (a refused
 * connection that names its target, a malformed URL). The boot log is the one
 * place those errors surface, so the configured URL is cut out of the message.
 * Drizzle wraps the driver error, so its message names only the query: the
 * allow-listed driver code from the cause chain is appended (never the cause's
 * own text, which can name host and user).
 */
function describeError(err: unknown, env: Record<string, string | undefined>): string {
  const message = err instanceof Error ? err.message : "unknown error";
  const url = runtimeDatabaseUrl(env);
  const scrubbed = url ? message.split(url).join("[database url]") : message;
  const code = safeDriverCode(err);
  return code ? `${scrubbed} (${code})` : scrubbed;
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
 * backoff (DEMO_CHECK_RETRY_DELAYS_MS), each attempt bounded by
 * DEMO_BOOT_ATTEMPT_DEADLINE_MS. A stamp mismatch is an answer, not an error:
 * it is never retried and fails at once. If the database still cannot be
 * REACHED after the retries (a connection-class error, isConnectionClassError)
 * the demo does not exit: the marketing and legal pages need no data. It keeps
 * the installation gate closed (lib/config/boot-state.ts), so getDb() throws
 * and database-backed routes answer 503, and registers a recheck that a request
 * starts at most every DEMO_RECHECK_INTERVAL_MS. The gate is closed before the
 * first attempt and opens only when the check passes (or the database predates
 * the stamp). Any other error (credentials, TLS, an unexpected throw) still
 * fails the boot. Production never uses the gate: it retries connection-class errors only,
 * for about five seconds (PRODUCTION_CHECK_RETRY_DELAYS_MS), then exits.
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
    // Only an exact "demo" (in a build that has demo) opens the demo doors; anything
    // else is the safe default, which is easy to hit by a typo such as "Demo".
    const requested = env.JEEVES_MODE?.trim();
    if (requested && requested.toLowerCase() !== "production") {
      log("[boot] JEEVES_MODE is set but ignored: this server runs in production mode (demo needs exactly JEEVES_MODE=demo and a demo build).");
    }
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
  } else {
    // Production reports this in assertProductionConfig. In demo a malformed
    // value would silently put every caller in one rate-limit bucket, so it
    // fails the boot; unset is only a warning (Vercel overwrites the header).
    const hops = trustedProxyHopsState(env);
    if (hops === "malformed") {
      fail("JEEVES_TRUSTED_PROXY_HOPS must be a non-negative integer or none (none with no proxy in front, 0 on Vercel, 1 behind an AWS ALB)");
      return;
    }
    if (hops === "unset" && !env.VERCEL) {
      log(
        "[boot] JEEVES_TRUSTED_PROXY_HOPS is not set: rate limits key on the leftmost X-Forwarded-For entry, " +
          "which a caller can forge unless the proxy in front overwrites it. Set it (none with no proxy in front, 1 behind an AWS ALB or an appending proxy).",
      );
    }
    if (!runtimeDatabaseUrl(env) && env.DATA_PROVIDER?.trim().toLowerCase() !== "db") return;
  }

  if (mode !== "demo") {
    await checkInstallation();
    return;
  }

  // Demo: nothing may read the database until the check has passed in this
  // process. Whatever happens below, on return the gate is open, or it is
  // closed with a recheck registered, or the boot has failed.
  closeInstallationGate();
  try {
    await checkInstallation();
  } catch (err) {
    const reason = `installation check failed unexpectedly: ${describeError(err, env)}`;
    markBootFailed(reason);
    try {
      log(`[boot] ${reason}`);
      log("[boot] refusing to start; exiting.");
    } catch {
      // The sink is what failed; the flag above and the exit below still apply.
    }
    exit(1);
  }

  async function checkInstallation(): Promise<void> {
    const delays = mode === "demo" ? DEMO_CHECK_RETRY_DELAYS_MS : PRODUCTION_CHECK_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        const verify = async () => verifyInstallation(await getDb(), mode);
        await withDeadline(verify(), DEMO_BOOT_ATTEMPT_DEADLINE_MS);
        if (mode === "demo") openInstallationGate();
        return;
      } catch (err) {
        if (err instanceof InstallationCheckError) {
          if (mode === "demo" && err.code === "not_migrated") {
            openInstallationGate();
            log(`[boot] ${err.message} Continuing without an installation stamp.`);
            return;
          }
          fail(`installation check failed: ${err.message}`);
          return;
        }
        // Demo retries any error (its failure mode is a waking Neon compute);
        // production retries only what says the database cannot be reached.
        if (attempt < delays.length && (mode === "demo" || isConnectionClassError(err))) {
          log(
            `[boot] installation check could not read the database (attempt ${attempt + 1} of ${delays.length + 1}): ` +
              `${describeError(err, env)}; retrying in ${delays[attempt]} ms.`,
          );
          await sleep(delays[attempt]);
          continue;
        }
        if (mode === "demo" && isConnectionClassError(err)) {
          setInstallationRecheck(() => recheckDemoInstallation({ env, exit, log, getDb }));
          log(
            `[boot] installation check could not reach the database: ${describeError(err, env)}. ` +
              "Continuing: pages that need no data are served, and database-backed routes answer 503 until the stamp is verified.",
          );
          return;
        }
        fail(`installation check failed: could not read the installation stamp: ${describeError(err, env)}`);
        return;
      }
    }
  }
}

/**
 * Run again, while a demo's installation gate is closed, the check that could
 * not reach the database at boot. Registered by runBootChecks and started by a
 * request (lib/http/database-gate.ts), never awaited by one. Passing (or a
 * database that predates the stamp) opens the gate; still unreachable or past
 * DEMO_RECHECK_DEADLINE_MS leaves it closed; any other outcome fails the boot
 * exactly as at boot. An attempt abandoned at the deadline may finish later and
 * stamp concurrently with the next one: the stamp insert is
 * onConflictDoNothing (lib/demo/bootstrap.ts), so that is safe.
 */
export async function recheckDemoInstallation(deps: BootCheckDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args));
  const getDb = deps.getDb ?? defaultGetDb;
  const fail = (reason: string): void => {
    markBootFailed(reason);
    log(`[boot] ${reason}`);
    log("[boot] refusing to start; exiting.");
    exit(1);
  };
  try {
    await withDeadline(
      (async () => verifyInstallation(await getDb(), "demo"))(),
      DEMO_RECHECK_DEADLINE_MS,
    );
    openInstallationGate();
    log("[boot] installation verified; database-backed routes are open.");
  } catch (err) {
    if (err instanceof InstallationCheckError) {
      if (err.code === "not_migrated") {
        openInstallationGate();
        log(`[boot] ${err.message} Continuing without an installation stamp.`);
        return;
      }
      fail(`installation check failed: ${err.message}`);
      return;
    }
    if (isConnectionClassError(err)) {
      log(`[boot] installation recheck could not reach the database: ${describeError(err, env)}.`);
      return;
    }
    fail(`installation check failed: could not read the installation stamp: ${describeError(err, env)}`);
  }
}
