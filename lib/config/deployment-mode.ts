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
import { parsePostgresUrl } from "../db/connection-config";
import { selectDriver } from "../db/driver-select";
import { runtimeDatabaseUrl } from "../db/runtime-config";
import { DB_TLS_OPT_OUT_VALUE, databaseTlsPosture, unverifiedDatabaseProblem } from "../db/tls-posture";

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

/**
 * The one rule for APP_BASE_URL, shared with installBaseUrl (site-metadata.ts):
 * an https origin. The value becomes metadataBase and og:url, so a path, query
 * or fragment would silently change what those resolve to. Returns the parsed
 * URL, or null when the (trimmed) value is not one.
 */
export function parseOriginUrl(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ok =
      url.protocol === "https:" &&
      url.hostname !== "" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !raw.includes("?") &&
      !raw.includes("#");
    return ok ? url : null;
  } catch {
    return null;
  }
}

const PLACEHOLDER_SECRETS = ["changeme", "change-me", "change_me", "secret", "password", "placeholder", "replaceme", "replace-me", "replace_me", "example", "default", "test", "jeeves"];

/** A secret nobody chose: one repeated character, or a known placeholder word (alone or repeated). */
function isWeakSecret(value: string): boolean {
  if (new Set(value).size === 1) return true;
  const lower = value.toLowerCase();
  return PLACEHOLDER_SECRETS.some((word) => lower.length % word.length === 0 && lower === word.repeat(lower.length / word.length));
}

/**
 * State of JEEVES_TRUSTED_PROXY_HOPS, parsed the way lib/services/route-guard.ts
 * parses it: blank is unset, a non-negative safe integer or the keyword `none`
 * (case-insensitive: no proxy in front, header ignored) is valid, anything
 * else is malformed (route-guard then rate-limits every caller as one client).
 */
export function trustedProxyHopsState(env: Env = process.env): "unset" | "valid" | "malformed" {
  const raw = env.JEEVES_TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return "unset";
  if (raw.toLowerCase() === "none") return "valid";
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? "valid" : "malformed";
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
 *
 * Database TLS: a database on another host needs verified TLS as node-postgres
 * or the Neon driver will actually open it (lib/db/tls-posture.ts); loopback is
 * exempt. JEEVES_DB_ALLOW_UNVERIFIED=same-host is the only opt-out, and any
 * other value fails the boot rather than being read as off.
 */
export function assertProductionConfig(env: Env = process.env): void {
  const problems: string[] = [];

  if (selectDriver(runtimeDatabaseUrl(env), env.JEEVES_DB_DRIVER) === "pglite") {
    problems.push(
      "DATABASE_URL (or POSTGRES_URL) is required: without it the app would fall back to the local PGlite store, which production never uses",
    );
  }

  const databaseUrl = runtimeDatabaseUrl(env);
  let databaseUrlInvalid = false;
  if (databaseUrl && selectDriver(databaseUrl, env.JEEVES_DB_DRIVER) !== "pglite") {
    try {
      parsePostgresUrl(databaseUrl);
    } catch (error) {
      databaseUrlInvalid = true;
      // The parser's message never echoes the URL, which carries the password.
      problems.push(`DATABASE_URL (or POSTGRES_URL) is invalid: ${(error as Error).message}`);
    }
  }

  const optOut = env.JEEVES_DB_ALLOW_UNVERIFIED?.trim() ?? "";
  if (optOut && optOut !== DB_TLS_OPT_OUT_VALUE) {
    problems.push(
      "JEEVES_DB_ALLOW_UNVERIFIED must be same-host or unset: same-host allows a database on this host's private network " +
        "without verified TLS; any other value is refused rather than read as off",
    );
  }
  const tls = databaseUrlInvalid ? ({ kind: "no_database" } as const) : databaseTlsPosture(env);
  if (tls.kind === "refused") problems.push(tls.message);
  else if (tls.kind === "unverified" && optOut !== DB_TLS_OPT_OUT_VALUE) problems.push(unverifiedDatabaseProblem(tls.cause));

  if (env.DATA_PROVIDER?.trim().toLowerCase() === "mock") {
    problems.push("DATA_PROVIDER=mock is not allowed in production: it serves fixture data instead of the database");
  }

  const cookieSecret = env.JEEVES_COOKIE_SECRET?.trim() ?? "";
  if (cookieSecret && isWeakSecret(cookieSecret)) {
    problems.push("JEEVES_COOKIE_SECRET is too weak: it looks like a placeholder or one repeated character (use `openssl rand -hex 32`)");
  } else if (!cookieSecret) {
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
  } else if (!parseOriginUrl(baseUrl)) {
    problems.push("APP_BASE_URL must be an https origin (scheme, host and optional port only: no path, query, fragment or credentials)");
  }

  if (!env.JEEVES_TENANT_ID?.trim()) {
    problems.push("JEEVES_TENANT_ID is required: the identifier of the organisation this install serves");
  }

  const hops = trustedProxyHopsState(env);
  if (hops === "unset") {
    problems.push(
      "JEEVES_TRUSTED_PROXY_HOPS is required: how many reverse proxies in front of the app append to X-Forwarded-For " +
        "(none with no proxy in front, 0 only when the platform overwrites the header, 1 behind an AWS ALB); unset, rate limits key on a caller-supplied header",
    );
  } else if (hops === "malformed") {
    problems.push("JEEVES_TRUSTED_PROXY_HOPS must be a non-negative integer or none (none with no proxy in front, 0 on Vercel, 1 behind an AWS ALB, 2 behind CloudFront and an ALB)");
  }

  if (problems.length > 0) throw new ProductionConfigError(problems);
}
