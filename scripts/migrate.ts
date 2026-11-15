/**
 * `npm run db:migrate` — apply pending migrations, and nothing else.
 *
 * This is the SAFE counterpart to `npm run db:seed`. The seed script wipes
 * and repopulates every table (including disabling the `audit_events`
 * append-only triggers so it can delete the audit log), which makes it
 * unusable for applying a schema change to a database that holds real data.
 * Until this script existed there was no other migrate path, so the only
 * documented way to migrate a deployment destroyed its compliance record.
 *
 * Unlike seed.ts this needs no NODE_ENV/ALLOW_SEED guard: it is
 * non-destructive by construction (see lib/db/migrate.ts and its tests),
 * and running it against production is the intended use.
 */
import { describeMigrationTarget, runMigrations } from "../lib/db/migrate";

async function main() {
  const runtimeUrl = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim() || runtimeUrl;
  console.log(`Applying migrations to ${describeMigrationTarget(migrationUrl || undefined)}`);
  await runMigrations();

  console.log("Migrations up to date. No seed or reset was run.");

}

/**
 * What an operator needs to act on a failed upgrade: SQLSTATE, the driver's
 * message, constraint and table. Not Postgres's `detail`, which echoes row
 * values. Connection strings are removed, and so are the password and the
 * fully qualified host or IP address of each configured URL wherever they
 * appear on their own.
 */
export function describeMigrationFailure(err: unknown): string {
  let root: unknown = err;
  for (let i = 0; i < 5 && typeof root === "object" && root !== null && "cause" in root && root.cause; i++) root = root.cause;
  const field = (key: string) => {
    const value = typeof root === "object" && root !== null ? (root as Record<string, unknown>)[key] : undefined;
    return typeof value === "string" && value ? value : undefined;
  };
  const code = field("code");
  const message = root instanceof Error ? root.message : typeof root === "string" ? root : "";
  const parts = [
    `Migration failed${code && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ""}${message ? `: ${message}` : ""}`,
    ...(["constraint", "table"] as const).flatMap((k) => (field(k) ? [`${k}: ${field(k)}`] : [])),
  ];
  let text = parts.join("\n");
  for (const secret of [process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.DATABASE_MIGRATION_URL]) {
    if (!secret?.trim()) continue;
    text = text.split(secret.trim()).join("[redacted]");
    try {
      const url = new URL(secret.trim());
      // A single-label host (localhost, a compose service name) is no secret,
      // and blanking it would blank ordinary words in the message.
      const host = /[.:]/.test(url.hostname) ? url.hostname : "";
      // The password as the URL spells it and as the server sees it.
      let decoded = url.password;
      try { decoded = decodeURIComponent(url.password); } catch { /* keep the raw form */ }
      for (const part of [host, url.password, decoded]) if (part) text = text.split(part).join("[redacted]");
    } catch { /* not a parsable URL: the whole-string redaction above is all we can do */ }
  }
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(describeMigrationFailure(err));
    process.exitCode = 1;
  });
}
