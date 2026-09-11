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
import { applyMigrations, describeMigrationTarget } from "../lib/db/migrate";

async function main() {
  const { getDb, closeDb } = await import("../lib/db/client");

  // Safe to print: reconstructed from the parsed host + database name only,
  // never echoing the connection string (it carries a password).
  console.log(`Applying migrations to ${describeMigrationTarget(process.env.DATABASE_URL)}`);

  const db = getDb();
  await applyMigrations(db);

  console.log("Migrations up to date. No rows were modified.");

  // Release the PGlite handle so the CLI process exits promptly.
  await closeDb();
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
