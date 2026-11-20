// What TLS the database connection would really have, for the production boot check.
//
// The question is not what the URL looks like but what the driver will do, so
// this mirrors node-postgres 8.23 (pg/lib/connection-parameters.js) and
// pg-connection-string 2.14 (index.js) option by option, without importing
// them. lib/db/tls-posture.test.ts compares it with the installed pg over a
// cross product of options and fails when an upgrade changes their meaning
// (pg 9 gives sslmode=require libpq semantics).
//
// Imported, through deployment-mode, by proxy.ts: no node built-ins, and pg
// only as a type. Messages never carry the URL, user, password, host, port or
// an option value: the only text taken from elsewhere is the fixed error string
// of parsePostgresUrl and postgresPoolConfig.
import type { PoolConfig } from "pg";
import { parsePostgresUrl, postgresPoolConfig } from "./connection-config";
import { normalizeHost, selectDriver } from "./driver-select";
import { runtimeDatabaseUrl } from "./runtime-config";

type Env = Record<string, string | undefined>;

export const DB_TLS_OPT_OUT_VALUE = "same-host";

export type DatabaseTlsCause =
  | "plaintext"
  | "verification_off"
  | "node_tls_reject_unauthorized"
  | "host_name_not_checked"
  | "unrecognised_ssl_option";

export type DatabaseTlsPosture =
  | { kind: "no_database" }
  | { kind: "loopback" }
  | { kind: "verified" }
  | { kind: "unverified"; cause: DatabaseTlsCause }
  | { kind: "refused"; message: string };

/** node-postgres throws on these settings when it opens a connection. */
export const PG_REFUSES = Symbol("node-postgres refuses these TLS options");
/** node-postgres cannot parse the connection string at all (a raw % or space anywhere in it, with an IPv6 literal host, for one). */
export const PG_UNPARSEABLE = Symbol("node-postgres cannot parse the database URL");

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/** localhost, 127.a.b.c written in full, [::1] or a unix socket. Anything that only looks local is not. */
export function isLoopbackDatabaseHost(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  return host.startsWith("/") || host === "localhost" || host === "[::1]" || LOOPBACK_V4.test(host);
}

/** The TLS option node-postgres would end up with for this pool config, PG_REFUSES, or PG_UNPARSEABLE. */
export function effectivePgSsl(config: PoolConfig, env: Env): unknown {
  let text = config.connectionString ?? "";
  // pg-connection-string re-encodes a string with a space or a bad escape before parsing.
  if (/( |%[^a-f0-9]|%[a-f0-9][^a-f0-9])/i.test(text)) text = encodeURI(text).replace(/%25(\d\d)/g, "%$1");
  let url: URL;
  try {
    url = new URL(text, "postgres://base");
  } catch {
    try {
      url = new URL(text.replace("@/", "@___DUMMY___/"), "postgres://base");
    } catch {
      return PG_UNPARSEABLE;
    }
  }
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams.entries()) query[key] = value;

  let ssl: unknown = undefined;
  if (query.ssl !== undefined) ssl = query.ssl === "true" || query.ssl === "1" ? true : query.ssl === "0" ? false : query.ssl;
  let object: { rejectUnauthorized?: boolean; checkServerIdentity?: boolean } | undefined;
  if (query.sslcert || query.sslkey || query.sslrootcert || query.sslmode) {
    object = {};
    ssl = object;
  }
  if (query.sslnegotiation === "direct" && ssl === undefined) ssl = true;

  if (query.uselibpqcompat === "true") {
    switch (query.sslmode) {
      case "disable":
        ssl = false;
        break;
      case "prefer":
        object!.rejectUnauthorized = false;
        break;
      case "require":
        if (query.sslrootcert) object!.checkServerIdentity = true;
        else object!.rejectUnauthorized = false;
        break;
      case "verify-ca":
        if (!query.sslrootcert) return PG_REFUSES;
        object!.checkServerIdentity = true;
        break;
    }
  } else if (query.sslmode === "disable") {
    ssl = false;
  } else if (query.sslmode === "no-verify") {
    object!.rejectUnauthorized = false;
  }

  // pg: the URL's TLS settings win over config.ssl, which wins over PGSSLMODE.
  if (ssl === undefined) ssl = config.ssl;
  if (ssl === undefined) {
    switch (env.PGSSLMODE) {
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        ssl = true;
        break;
      case "no-verify":
        ssl = { rejectUnauthorized: false };
        break;
      default:
        ssl = false;
    }
  }
  if (ssl === "true") ssl = true;
  if (ssl === "no-verify") ssl = { rejectUnauthorized: false };

  const negotiation = query.sslnegotiation || env.PGSSLNEGOTIATION;
  if (negotiation !== undefined && negotiation !== "" && negotiation !== "postgres" && negotiation !== "direct") return PG_REFUSES;
  if (negotiation === "direct" && !ssl) return PG_REFUSES;
  return ssl;
}

const PG_REFUSED_MESSAGE =
  "The database connection settings are refused: node-postgres rejects these TLS options " +
  "(uselibpqcompat=true with sslmode=verify-ca needs sslrootcert; sslnegotiation must be postgres or direct, and direct needs TLS)";

const PG_UNPARSEABLE_MESSAGE =
  "The database URL is refused: node-postgres cannot parse it (percent-encode %, spaces and other special characters in the password and query)";

/** Classify the ssl option node-postgres ends up with. */
export function classifyPgSsl(ssl: unknown, env: Env): DatabaseTlsPosture {
  if (ssl === PG_UNPARSEABLE) return { kind: "refused", message: PG_UNPARSEABLE_MESSAGE };
  if (ssl === PG_REFUSES) return { kind: "refused", message: PG_REFUSED_MESSAGE };
  if (!ssl) return { kind: "unverified", cause: "plaintext" };
  const nodeOff: DatabaseTlsPosture = { kind: "unverified", cause: "node_tls_reject_unauthorized" };
  if (ssl === true) return env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? nodeOff : { kind: "verified" };
  if (typeof ssl === "string") return { kind: "unverified", cause: "unrecognised_ssl_option" };
  if (typeof ssl === "object") {
    const options = ssl as { rejectUnauthorized?: unknown; checkServerIdentity?: unknown };
    if (options.rejectUnauthorized === false) return { kind: "unverified", cause: "verification_off" };
    if (options.checkServerIdentity) return { kind: "unverified", cause: "host_name_not_checked" };
    if (options.rejectUnauthorized === true) return { kind: "verified" };
    return env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? nodeOff : { kind: "verified" };
  }
  return { kind: "unverified", cause: "unrecognised_ssl_option" };
}

/** The TLS posture of the runtime database connection, decided with the functions the client uses. */
export function databaseTlsPosture(env: Env = process.env): DatabaseTlsPosture {
  const databaseUrl = runtimeDatabaseUrl(env);
  const driver = selectDriver(databaseUrl, env.JEEVES_DB_DRIVER);
  if (!databaseUrl || driver === "pglite") return { kind: "no_database" };

  let url: URL;
  try {
    url = parsePostgresUrl(databaseUrl);
  } catch (error) {
    return { kind: "refused", message: `The database URL is refused: ${(error as Error).message}` };
  }
  if (isLoopbackDatabaseHost(url)) return { kind: "loopback" };

  // The Neon driver always speaks wss, whatever sslmode says.
  if (driver === "neon") {
    return env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
      ? { kind: "unverified", cause: "node_tls_reject_unauthorized" }
      : { kind: "verified" };
  }

  let config: PoolConfig;
  try {
    config = postgresPoolConfig(databaseUrl, env.DATABASE_SSL_CA, env);
  } catch (error) {
    return { kind: "refused", message: `The database connection settings are refused: ${(error as Error).message}` };
  }
  return classifyPgSsl(effectivePgSsl(config, env), env);
}

const CAUSE_REASONS: Record<DatabaseTlsCause, string> = {
  plaintext: "the connection would not be encrypted",
  verification_off:
    "certificate verification is turned off (sslmode=no-verify or ssl=no-verify in the URL, " +
    "uselibpqcompat=true with sslmode=prefer or require, or PGSSLMODE=no-verify)",
  node_tls_reject_unauthorized: "NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate verification off",
  host_name_not_checked:
    "uselibpqcompat=true with sslmode=verify-ca, or with sslmode=require and sslrootcert, skips the server name check",
  unrecognised_ssl_option:
    "the ssl option in the database URL has a value node-postgres does not recognise (it accepts true, 1, 0 and no-verify)",
};

/** The boot problem for a database on another host without verified TLS: the reason and both ways out. */
export function unverifiedDatabaseProblem(cause: DatabaseTlsCause): string {
  return (
    `The database is on another host and the connection is not verified TLS: ${CAUSE_REASONS[cause]}. ` +
    "Either configure TLS with certificate verification (add sslmode=verify-full to DATABASE_URL, or set " +
    "DATABASE_SSL_CA to the server's CA certificate in PEM; for Amazon RDS, the RDS CA bundle), or, only if the " +
    `database runs on this machine or a private container network of this host, set JEEVES_DB_ALLOW_UNVERIFIED=${DB_TLS_OPT_OUT_VALUE}`
  );
}
