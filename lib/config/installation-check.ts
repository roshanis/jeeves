// Boot-time check of the installation stamp (drizzle/0015_installation.sql).
//
// The stamp is the database's own statement of what it is. JEEVES_MODE is the
// process's statement of what it should be. Booting with the two disagreeing
// is how a demo process ends up serving passwordless personas on a customer's
// data, or a production process ends up serving a database full of seeded demo
// rows, so every boot compares them and refuses on any mismatch.
import { sql } from "drizzle-orm";
import { ensureDemoInstallation } from "../demo/bootstrap";
import {
  installationTableExists,
  readInstallationStamp,
  type InstallationDb,
} from "../db/installation";
import type { DeploymentMode } from "./deployment-mode";

export type InstallationCheckCode =
  /** Migration 0015 has not been applied: there is no installation table. */
  | "not_migrated"
  /** Production, and the database carries no stamp. */
  | "no_stamp"
  /** The stamp says one mode and the process is running the other. */
  | "mode_mismatch"
  /** Production, and the database holds demo rows. */
  | "demo_data";

/**
 * Thrown by verifyInstallation(). The message names what was found and what to
 * do, never a workspace id, session token or other row content: it is logged at
 * boot and may reach a log aggregator.
 */
export class InstallationCheckError extends Error {
  readonly code: InstallationCheckCode;

  constructor(code: InstallationCheckCode, message: string) {
    super(message);
    this.name = "InstallationCheckError";
    this.code = code;
  }
}

/** How much demo data a production-stamped database holds. */
interface DemoDataCounts {
  noWorkspace: number;
  playgroundWorkspace: number;
  realRequestWorkspace: number;
  sessions: number;
}

/**
 * Count the rows only the demo creates:
 *  - initiatives with no workspace: seeded rows, visible to everyone by design;
 *  - initiatives in a `ws_` workspace: a playground visitor's work;
 *  - initiatives in a `public-` workspace: a real-request submitter's work;
 *  - any session: persona and public sessions are the only kind that exist
 *    until production sign-in lands, and a persona or public session in a
 *    production database is a door opened by the demo.
 *
 * `starts_with`, not LIKE: `_` is a LIKE wildcard, and "ws_" must match
 * literally. Counts are cast to int so every driver returns a number.
 *
 * Phase P3 gives production its own, legitimate, sessions; it narrows the
 * session count to persona/public rows when it does.
 */
async function countDemoData(db: InstallationDb): Promise<DemoDataCounts> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM initiatives WHERE workspace_id IS NULL) AS no_workspace,
      (SELECT count(*)::int FROM initiatives WHERE starts_with(workspace_id, 'ws_')) AS playground_workspace,
      (SELECT count(*)::int FROM initiatives WHERE starts_with(workspace_id, 'public-')) AS real_request_workspace,
      (SELECT count(*)::int FROM sessions) AS sessions
  `);
  const rows = (Array.isArray(result) ? result : result.rows) as {
    no_workspace: number;
    playground_workspace: number;
    real_request_workspace: number;
    sessions: number;
  }[];
  const row = rows[0];
  return {
    noWorkspace: Number(row.no_workspace),
    playgroundWorkspace: Number(row.playground_workspace),
    realRequestWorkspace: Number(row.real_request_workspace),
    sessions: Number(row.sessions),
  };
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function describeDemoData(counts: DemoDataCounts): string[] {
  const found: string[] = [];
  if (counts.noWorkspace > 0) {
    found.push(`${plural(counts.noWorkspace, "initiative")} with no workspace (seeded demo rows)`);
  }
  if (counts.playgroundWorkspace > 0) {
    found.push(`${plural(counts.playgroundWorkspace, "initiative")} in a playground workspace`);
  }
  if (counts.realRequestWorkspace > 0) {
    found.push(`${plural(counts.realRequestWorkspace, "initiative")} in a real-request workspace`);
  }
  if (counts.sessions > 0) {
    found.push(`${plural(counts.sessions, "session")} (persona or public)`);
  }
  return found;
}

/**
 * Verify that this database may serve a process running in `mode`; throws
 * InstallationCheckError when it may not.
 *
 *  - demo: stamp 'demo' when the database has no stamp (the live demo database
 *    predates the stamp and cannot be reseeded, so it is stamped in place by the
 *    demo bootstrap), then require the stamp to be 'demo'. Demo data is what a
 *    demo database holds, so none of the production data checks apply.
 *  - production: require an existing 'production' stamp. A production process
 *    never stamps for itself: an unstamped database is one the install script
 *    has not prepared. It also refuses a stamped database that holds demo data
 *    (see countDemoData).
 */
export async function verifyInstallation(db: InstallationDb, mode: DeploymentMode): Promise<void> {
  if (!(await installationTableExists(db))) {
    throw new InstallationCheckError(
      "not_migrated",
      mode === "demo"
        ? "The installation table is missing: migration 0015 has not been applied to this database. Run `npm run db:migrate`."
        : "The installation table is missing: this database has not been prepared for a production install. " +
            "Production databases are migrated and stamped by the install script (planned for phase P4, " +
            "not available yet); refusing to start.",
    );
  }

  let stamped: DeploymentMode;
  if (mode === "demo") {
    stamped = (await ensureDemoInstallation(db)).deployMode;
  } else {
    const stamp = await readInstallationStamp(db);
    if (!stamp) {
      throw new InstallationCheckError(
        "no_stamp",
        "This database has no installation stamp, so it has not been prepared as a production install. " +
          "Production databases are stamped by the install script, which arrives in phase P4 and is not " +
          "available yet; refusing to start rather than stamping the database automatically.",
      );
    }
    stamped = stamp.deployMode;
  }

  if (stamped !== mode) {
    throw new InstallationCheckError(
      "mode_mismatch",
      `This database is stamped "${stamped}" but the server is running in ${mode} mode ` +
        (mode === "demo"
          ? "(JEEVES_MODE=demo). Refusing to start: the demo's passwordless personas must never open on a production database."
          : "(JEEVES_MODE is not \"demo\"). Refusing to start: a demo database must never serve a production install."),
    );
  }

  if (mode === "production") {
    const found = describeDemoData(await countDemoData(db));
    if (found.length > 0) {
      throw new InstallationCheckError(
        "demo_data",
        `This production database holds demo data, which a production install must never contain: ${found.join(", ")}. ` +
          "Refusing to start. Install into an empty database.",
      );
    }
  }
}
