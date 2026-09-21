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

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    const code = typeof err === "object" && err !== null && "code" in err &&
      typeof err.code === "string" && /^[A-Z0-9_]+$/.test(err.code)
      ? ` (${err.code})`
      : "";
    console.error(`Migration failed${code}. Check the database configuration and migration connection.`);
    process.exitCode = 1;
  });
}
