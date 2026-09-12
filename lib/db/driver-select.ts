// Which Postgres driver to use for a given DATABASE_URL.
//
// Extracted from getDb() and given its own tests because getting it wrong is
// silent until runtime and then baffling. getDb() previously chose the Neon
// serverless driver for ANY DATABASE_URL. That driver talks to Neon's
// WebSocket proxy rather than speaking the Postgres wire protocol, so against
// a plain Postgres server it fails like this (verified against a real
// PostgreSQL 16 at 127.0.0.1:5432):
//
//     cause: ErrorEvent - connect ECONNREFUSED 127.0.0.1:443
//
// It ignored the :5432 in the URL and dialled 443. Any container deploy with
// a postgres sidecar — including the Podman setup in deploy/podman/ — would
// have hit that, with an error naming a port nobody configured.
//
// Host-based selection keeps Vercel + Neon on exactly the driver it uses
// today, and gives everything else node-postgres. In a long-lived container
// node-postgres is the better fit anyway: a real connection pool and no proxy
// hop.

export type DbDriver = "neon" | "pg" | "pglite";

/** Neon's endpoint domain. Matched as a suffix on the parsed host, never as
 *  a substring of the raw URL — "neon.tech.evil.example.com" is not Neon. */
const NEON_HOST_SUFFIX = ".neon.tech";

/**
 * @param databaseUrl  process.env.DATABASE_URL
 * @param override     process.env.JEEVES_DB_DRIVER — "neon" or "pg"; anything
 *                     else is ignored rather than guessed at.
 */
export function selectDriver(
  databaseUrl: string | undefined,
  override: string | undefined,
): DbDriver {
  // No URL means the local PGlite store, regardless of any override: forcing
  // a driver with nothing to connect to should not pretend otherwise.
  if (!databaseUrl) return "pglite";

  if (override === "neon" || override === "pg") return override;

  try {
    const { hostname } = new URL(databaseUrl);
    return hostname.endsWith(NEON_HOST_SUFFIX) ? "neon" : "pg";
  } catch {
    // Unparseable means "not demonstrably Neon". node-postgres is the safer
    // default: it will surface a real connection error rather than silently
    // dialling a proxy that was never there.
    return "pg";
  }
}
