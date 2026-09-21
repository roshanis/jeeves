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

/** Bounded node-postgres pool; Supabase endpoints always use verifying TLS. */
export function postgresPoolConfig(databaseUrl: string, sslCa?: string): PoolConfig {
  const url = parsePostgresUrl(databaseUrl);
  const base = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 };
  if (!isSupabase(url)) return { ...base, connectionString: databaseUrl };

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
