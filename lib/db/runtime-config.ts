export type DatabaseEnvironment = Record<string, string | undefined>;

/** Resolve the database URL supplied by either app configuration or Vercel's integration. */
export function runtimeDatabaseUrl(env: DatabaseEnvironment = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || undefined;
}

/** A serverless runtime must never try to create a local on-disk database. */
export function assertRuntimeDatabaseConfigured(
  databaseUrl: string | undefined,
  vercel: string | undefined,
): void {
  if (vercel === "1" && !databaseUrl) {
    throw new Error("Database is not configured: set DATABASE_URL or POSTGRES_URL.");
  }
}
