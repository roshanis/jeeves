import type { PoolConfig } from "pg";

function parsePostgresUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error();
    assertNoEndpointOverrides(url);
    return url;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not override")) throw error;
    throw new Error("A valid PostgreSQL database URL is required.");
  }
}

function isSupabase(url: URL): boolean {
  const hostname = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/, "");
  return hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com");
}

function assertNoEndpointOverrides(url: URL): void {
  const hosts = url.searchParams.getAll("host");
  const localSocket = hosts.length === 1 && hosts[0]!.startsWith("/") &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.searchParams.has("port") || url.searchParams.has("hostaddr") ||
      (hosts.length > 0 && !localSocket)) {
    throw new Error("Database URLs must not override network hosts or ports in query parameters.");
  }
}

/** The URL parser's TLS settings override explicit ones, so a CA needs a URL with no TLS options. */
function genericConfig(base: PoolConfig, databaseUrl: string, url: URL, sslCa?: string): PoolConfig {
  if (!sslCa?.trim()) return { ...base, connectionString: databaseUrl };
  const params = url.searchParams;
  if (params.getAll("sslmode").some((mode) => !["prefer", "require", "verify-ca", "verify-full"].includes(mode)) ||
      ["disable", "no-verify", "false", "0"].includes(params.get("ssl") ?? "")) {
    throw new Error("DATABASE_SSL_CA is set but the database URL turns TLS or certificate verification off. Remove one of the two.");
  }
  if (["ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"].some((key) => params.has(key))) {
    throw new Error("DATABASE_SSL_CA cannot be combined with ssl, sslcert, sslkey, sslrootcert, sslnegotiation or uselibpqcompat in the database URL; use one source of TLS settings.");
  }
  params.delete("sslmode");
  // Hostname verification stays on, which is stricter than libpq's verify-ca.
  return { ...base, connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca: sslCa } };
}

/** A positive integer from an environment value, else the fallback. */
function positiveInt(value: string | undefined, fallback: number | undefined): number | undefined {
  const n = Number(value?.trim());
  return value?.trim() && Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/**
 * Bounded node-postgres pool; Supabase endpoints always use verifying TLS.
 * Generic hosts also get server-side statement and idle-in-transaction
 * timeouts (generous defaults, env-overridable) so a stuck statement cannot
 * hold a pooled connection forever. Supabase keeps its pool of one and its
 * startup parameters unchanged: its poolers may reject unknown ones.
 */
export function postgresPoolConfig(
  databaseUrl: string,
  sslCa?: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  const url = parsePostgresUrl(databaseUrl);
  const base = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 };
  if (!isSupabase(url)) {
    const max = positiveInt(env.DATABASE_POOL_MAX, undefined);
    return genericConfig({
      ...base,
      ...(max ? { max } : {}),
      keepAlive: true,
      application_name: "jeeves",
      statement_timeout: positiveInt(env.DATABASE_STATEMENT_TIMEOUT_MS, 60_000),
      idle_in_transaction_session_timeout: positiveInt(env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS, 60_000),
    }, databaseUrl, url, sslCa);
  }

  const modes = url.searchParams.getAll("sslmode");
  if (modes.some((mode) => !["require", "verify-ca", "verify-full"].includes(mode)) ||
      ["ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"]
        .some((key) => url.searchParams.has(key))) {
    throw new Error("Supabase requires verified TLS. Remove conflicting SSL URL options; use DATABASE_SSL_CA for a project CA.");
  }
  url.searchParams.delete("sslmode");
  return {
    ...base,
    connectionString: url.toString(),
    max: 1,
    ssl: { rejectUnauthorized: true, ...(sslCa?.trim() ? { ca: sslCa } : {}) },
  };
}

/**
 * One connection for migrations. No statement_timeout (a migration may run
 * long), but a lock_timeout so a migration queued behind an open transaction
 * fails fast and can be retried instead of waiting while holding locks.
 */
export function migrationPoolConfig(
  databaseUrl: string,
  sslCa?: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  const config = { ...postgresPoolConfig(databaseUrl, sslCa, env) };
  delete config.statement_timeout;
  delete config.idle_in_transaction_session_timeout;
  const lockMs = positiveInt(env.DATABASE_MIGRATION_LOCK_TIMEOUT_MS, 10_000);
  return { ...config, max: 1, options: `-c lock_timeout=${lockMs}` };
}

/** Transaction pooling is unsuitable for migrations that need session state. */
export function migrationDatabaseUrl(runtimeUrl: string | undefined, migrationUrl?: string): string | undefined {
  const selected = migrationUrl?.trim() || runtimeUrl?.trim();
  if (!selected) return undefined;
  const url = parsePostgresUrl(selected);
  if (isSupabase(url) && url.port === "6543") {
    throw new Error("Set DATABASE_MIGRATION_URL to a Supabase direct or session-pooler connection on port 5432; transaction pooling cannot run migrations.");
  }
  return selected;
}
