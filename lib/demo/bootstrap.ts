// Idempotent bootstrap for the demo database.
//
// The live demo database can never be reseeded: seedDatabase refuses once any
// evidence exists ("Refusing reset to preserve evidence history"), and a
// reseed would wipe visitors' work in any case. So everything the demo needs
// that is NOT in the original seed has to arrive on top of the existing rows,
// at boot, idempotently. This module is that place. Each step is an
// INSERT ... ON CONFLICT DO NOTHING (or an equivalent upsert) that is safe to
// run on every boot, on an empty database, on a populated one, and from
// several instances at once.
//
// Today the only step is the installation stamp. Later phases that need
// demo-side rows (persona users, the demo fast-lane policy) add their steps to
// ensureDemoInstallation() below, after the stamp and only when the stamp says
// 'demo', so a boot that cannot stamp, or that meets a production database,
// never goes on to write anything else.
//
// Demo only. It is called from the boot hook when JEEVES_MODE=demo and from
// the seed and reset scripts; production never runs it, and it never
// overwrites a 'production' stamp.
import { installation } from "../db/schema";
import {
  installationTableExists,
  readInstallationStamp,
  type InstallationDb,
} from "../db/installation";
import type { DeploymentMode } from "../config/deployment-mode";

export interface DemoBootstrapResult {
  /** True only for the call that wrote the stamp; false when one already existed. */
  stamped: boolean;
  /**
   * The mode the database is stamped with after the call. 'production' means
   * this is not a demo database: the bootstrap left it alone and the caller
   * must refuse to go on.
   */
  deployMode: DeploymentMode;
}

/**
 * Stamp 'demo' when the database has no stamp. Never changes an existing one.
 *
 * Requires migration 0015; callers that may meet an unmigrated database
 * check installationTableExists() first (the boot check and
 * assertDemoDatabase do).
 */
export async function ensureDemoInstallation(db: InstallationDb): Promise<DemoBootstrapResult> {
  const inserted = await db
    .insert(installation)
    .values({ deployMode: "demo", installId: crypto.randomUUID() })
    .onConflictDoNothing({ target: installation.id })
    .returning();

  const [stamp] = await db.select({ deployMode: installation.deployMode }).from(installation).limit(1);
  if (!stamp) {
    // Unreachable while the 0015 triggers are armed: DELETE and TRUNCATE are blocked.
    throw new Error("The installation stamp is missing straight after it was written.");
  }
  return { stamped: inserted.length > 0, deployMode: stamp.deployMode };
}

/**
 * Raised when a destructive demo script meets a database stamped 'production'.
 * The message is for the operator running the script, so it says why and what
 * does not help (ALLOW_SEED).
 */
export class ProductionDatabaseError extends Error {
  constructor() {
    super(
      'This database is stamped "production" (installation.deploy_mode), so demo maintenance is refused. ' +
        "scripts/seed.ts and scripts/reset-demo.ts wipe and repopulate data and only ever run against a demo " +
        "database; ALLOW_SEED does not override the stamp.",
    );
    this.name = "ProductionDatabaseError";
  }
}

/**
 * Entry guard for scripts/seed.ts and scripts/reset-demo.ts: stamp 'demo' when
 * the database has no stamp, and refuse when it is stamped 'production'.
 */
export async function assertDemoDatabase(db: InstallationDb): Promise<void> {
  if (!(await installationTableExists(db))) {
    throw new Error(
      "The installation table is missing (migration 0015 has not been applied). Run `npm run db:migrate` first.",
    );
  }
  const { deployMode } = await ensureDemoInstallation(db);
  if (deployMode !== "demo") throw new ProductionDatabaseError();
}

/**
 * Read-only variant for the seed CLI, which migrates before it seeds: refuse a
 * production database BEFORE any migration is applied to it. A database
 * without the installation table, or without a stamp, cannot be a stamped
 * production install, so it passes (and is stamped later by assertDemoDatabase).
 */
export async function refuseProductionDatabase(db: InstallationDb): Promise<void> {
  const stamp = await readInstallationStamp(db);
  if (stamp && stamp.deployMode !== "demo") throw new ProductionDatabaseError();
}
