// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { verifyInstallation, verifyRuntimeRole } from "../config/installation-check";
import { getEvidence, saveEvidenceDraft, submitEvidence, uploadEvidence } from "../services/evidence-service";
import { GUARD_TRIGGERS } from "./guard-triggers";

/**
 * The two-role layout (docs/deploy.md, "Database roles"): jeeves_owner owns the
 * schema and runs migrations, jeeves_app owns nothing and runs the app. The
 * grants file is applied before and after the migrate, and the app's real write
 * paths run as jeeves_app.
 */
const grants = readFileSync("./deploy/sql/jeeves-runtime-grants.sql", "utf8");
const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const owner = { actor: { id: "priya-raman", role: "requester" as const }, workspaceId: "workspace-a" };

describe("jeeves_owner / jeeves_app role layout", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle({ client, schema });
    await client.exec("CREATE ROLE jeeves_owner LOGIN NOSUPERUSER");
    await client.exec("CREATE ROLE jeeves_app LOGIN NOSUPERUSER");
    await client.exec(grants);
    await client.exec("SET ROLE jeeves_owner");
    await migrate(db, { migrationsFolder: "./drizzle" });
    const now = new Date();
    await db.insert(schema.initiatives).values({ id: "i", slug: "evidence-case", title: "Evidence case", requester: "Priya Raman", workspaceId: "workspace-a", state: "in_review", tier: "high", createdAt: now, updatedAt: now });
    await db.insert(schema.intakeVersions).values({ id: "intake", initiativeId: "i", version: 1, submitted: true, fields: {}, missing: [], createdAt: now });
    await db.insert(schema.riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "intake", tier: "high", flags: { phi: true, memberFacing: false, careCoverageInfluence: false, vendorHosted: true, humanInLoop: true, individualImpact: false }, requiredDomains: ["privacy-hipaa"], createdAt: now });
    await db.insert(schema.reviewCycles).values({ id: "cycle", initiativeId: "i", riskAssessmentId: "risk", kind: "initial", openedAt: now });
    await db.insert(schema.controlDefinitions).values({ id: "H-01", domain: "privacy-hipaa", name: "H-01", applicability: "all", owner: "Privacy", requiredEvidence: "Retention policy", cadence: "Annual", enforcementMode: "gate" });
    await client.exec("RESET ROLE");
    await client.exec(grants); // the second pass, after the tables exist
    await client.exec("SET ROLE jeeves_app");
  }, 60_000);

  afterAll(async () => { await client.close(); });

  const denied = (statement: string, message: RegExp) =>
    expect(client.exec(statement)).rejects.toThrow(message);

  it("passes the production role check: not a superuser, owns nothing", async () => {
    await expect(verifyRuntimeRole(db)).resolves.toBeUndefined();
  });

  it("cannot switch the guards off or change them", async () => {
    for (const { table, trigger } of GUARD_TRIGGERS) {
      await denied(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`, /must be owner|permission denied/);
      await denied(`DROP TRIGGER ${trigger} ON ${table}`, /must be owner|permission denied/);
    }
    await denied("ALTER TABLE audit_events DISABLE TRIGGER USER", /must be owner|permission denied/);
    await denied("CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$ BEGIN RETURN OLD; END $$ LANGUAGE plpgsql", /must be owner|permission denied/);
    await denied("CREATE TABLE intruder (id int)", /permission denied/);
    await denied("SET session_replication_role = replica", /permission denied/);
  });

  it("holds no UPDATE, DELETE or TRUNCATE on the append-only tables", async () => {
    await denied("UPDATE audit_events SET detail = 'x'", /permission denied/);
    await denied("DELETE FROM audit_events", /permission denied/);
    await denied("TRUNCATE audit_events", /permission denied/);
    await denied("UPDATE installation SET deploy_mode = 'demo'", /permission denied/);
    await denied("DELETE FROM installation", /permission denied/);
    await denied("DELETE FROM evidence_documents", /permission denied/);
    await denied("UPDATE evidence_assessments SET id = id", /permission denied/);
    await denied("DELETE FROM evidence_packets", /permission denied/);
    await denied("TRUNCATE initiatives CASCADE", /permission denied/);
  });

  it("reads the installation stamp and migration history, and inserts the stamp", async () => {
    await client.exec("INSERT INTO installation (deploy_mode, install_id) VALUES ('demo', 'inst-role')");
    await expect(verifyInstallation(db, "demo")).resolves.toBeUndefined();
  });

  it("runs the evidence write paths: upload, revise the draft, submit", async () => {
    const doc = await uploadEvidence(db, "i", owner, { requestId: "upload-request-00001", fileName: "retention.pdf", mediaType: "application/pdf", contentBase64: bytes.toString("base64") });
    const state = await getEvidence(db, "i", owner);
    const saved = await saveEvidenceDraft(db, "i", owner, { cycleId: "cycle", expectedRevision: state.draft?.revision ?? 0, entries: [{ controlId: "H-01", documentId: doc.id, pageReference: "1", note: "Retention policy evidence" }] });
    expect(saved.revision).toBeGreaterThan(0);
    await submitEvidence(db, "i", owner, { packetId: saved.id, expectedRevision: saved.revision });
    const audit = await db.execute(sql`SELECT count(*)::int AS n FROM audit_events WHERE initiative_id = 'i'`);
    expect(Number((audit.rows[0] as { n: number }).n)).toBeGreaterThan(0);
  });

  it("tables a later migration creates get the same grants through the default privileges", async () => {
    await client.exec("RESET ROLE");
    await client.exec("SET ROLE jeeves_owner");
    await client.exec("CREATE TABLE later_table (id serial PRIMARY KEY, note text)");
    await client.exec("RESET ROLE");
    await client.exec("SET ROLE jeeves_app");
    await client.exec("INSERT INTO later_table (note) VALUES ('ok')");
    await client.exec("UPDATE later_table SET note = 'changed'");
    await denied("TRUNCATE later_table", /permission denied/);
  });
});

describe("deploy/sql/jeeves-runtime-grants.sql is the SQL docs/deploy.md shows", () => {
  it("appears verbatim in the Database roles section", () => {
    const deployDoc = readFileSync("./docs/deploy.md", "utf8");
    const section = deployDoc.slice(deployDoc.indexOf("### Database roles"));
    expect(section).toContain(grants.trim());
  });
});
