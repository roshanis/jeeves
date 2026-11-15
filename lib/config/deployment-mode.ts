// Deployment mode: is this process the public demo, or a production install?
//
// The two are different products behind one codebase. Demo has passwordless
// personas, isolated playground workspaces, a public intake door and
// synthetic data; production has none of those. The flag is DEFAULT-PRODUCTION:
// demo is a positive opt-in, so a missing, empty or mistyped JEEVES_MODE
// ("Demo", "prod", " demo ") can never open the demo doors on a real install.
// The cost is that every demo, dev, test and CI path must say JEEVES_MODE=demo
// out loud; tests/deploy/demo-mode-env.test.ts guards that list.
//
// Server-only, and deliberately never a NEXT_PUBLIC_ variable: the mode must
// not be something the browser bundle can be built to believe.
import { selectDriver } from "../db/driver-select";
import { runtimeDatabaseUrl } from "../db/runtime-config";

export type DeploymentMode = "demo" | "production";

type Env = Record<string, string | undefined>;

/**
 * 'demo' only when JEEVES_MODE is exactly "demo" AND the build-time constant
 * JEEVES_DEMO_ENABLED is not "0". Anything else is production.
 *
 * JEEVES_DEMO_ENABLED is inlined by next.config.ts (`env`), so the literal
 * `process.env.JEEVES_DEMO_ENABLED` below becomes a constant in the compiled
 * server code. A production image is built with it "0", which makes demo
 * impossible there even if someone passes `-e JEEVES_MODE=demo` at run time.
 * The read of `process.env` is kept separate from the `env` parameter on
 * purpose: the inliner only rewrites that exact expression, and a caller
 * handing in a copy of the environment must not be able to override a locked
 * build.
 */
export function deploymentMode(env: Env = process.env): DeploymentMode {
  const demoBuilt = process.env.JEEVES_DEMO_ENABLED !== "0";
  return env.JEEVES_MODE === "demo" && demoBuilt && env.JEEVES_DEMO_ENABLED !== "0"
    ? "demo"
    : "production";
}

export function isDemoMode(env: Env = process.env): boolean {
  return deploymentMode(env) === "demo";
}

export function isProductionMode(env: Env = process.env): boolean {
  return deploymentMode(env) === "production";
}

/**
 * Thrown by assertProductionConfig() with EVERY problem found, so an operator
 * fixes the configuration in one pass instead of one redeploy per variable.
 * Messages name variables and rules, never configured values: the error is
 * logged at boot and may reach a log aggregator.
 */
export class ProductionConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid production configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ProductionConfigError";
    this.problems = problems;
  }
}

/** Minimum length of the secret that signs workspace/session cookies. */
const MIN_COOKIE_SECRET_LENGTH = 32;

function isPlainHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Validate the environment a production install needs, collecting all
 * problems into one ProductionConfigError.
 *
 * Does not require OPENAI_API_KEY: a production install without one simply
 * has its LLM features reported as "not configured".
 *
 * Database: a connection URL (DATABASE_URL, or the POSTGRES_URL alias that
 * lib/db/runtime-config.ts also reads) is required. lib/db/client.ts opens the
 * local PGlite store whenever that resolves to nothing, so "would select
 * PGlite" is decided with the same functions the client uses. Discrete PG*
 * settings (PGHOST/PGDATABASE/PGUSER) are not read by lib/db yet, so they do
 * not satisfy this check: accepting them would let a production boot silently
 * fall onto an ephemeral on-disk PGlite database. They become valid together
 * with the client support for them. (The production plan allowed PG* here; this
 * is a deliberate deviation from it that a human still has to acknowledge, to be
 * revisited with the client support in phase P5.3.)
 */
export function assertProductionConfig(env: Env = process.env): void {
  const problems: string[] = [];

  if (selectDriver(runtimeDatabaseUrl(env), env.JEEVES_DB_DRIVER) === "pglite") {
    problems.push(
      "DATABASE_URL (or POSTGRES_URL) is required: without it the app would fall back to the local PGlite store, which production never uses",
    );
  }

  if (env.DATA_PROVIDER?.trim().toLowerCase() === "mock") {
    problems.push("DATA_PROVIDER=mock is not allowed in production: it serves fixture data instead of the database");
  }

  const cookieSecret = env.JEEVES_COOKIE_SECRET?.trim() ?? "";
  if (!cookieSecret) {
    problems.push(
      `JEEVES_COOKIE_SECRET is required (at least ${MIN_COOKIE_SECRET_LENGTH} characters; DEMO_PASSCODE is not accepted as a fallback in production)`,
    );
  } else if (cookieSecret.length < MIN_COOKIE_SECRET_LENGTH) {
    problems.push(
      `JEEVES_COOKIE_SECRET is too short: it must be at least ${MIN_COOKIE_SECRET_LENGTH} characters (for example from \`openssl rand -hex 32\`)`,
    );
  }

  const baseUrl = env.APP_BASE_URL?.trim() ?? "";
  if (!baseUrl) {
    problems.push("APP_BASE_URL is required: the absolute https URL this install is served from");
  } else if (!isPlainHttpsUrl(baseUrl)) {
    problems.push("APP_BASE_URL must be an absolute https URL without embedded credentials");
  }

  if (!env.JEEVES_TENANT_ID?.trim()) {
    problems.push("JEEVES_TENANT_ID is required: the identifier of the organisation this install serves");
  }

  if (problems.length > 0) throw new ProductionConfigError(problems);
}
