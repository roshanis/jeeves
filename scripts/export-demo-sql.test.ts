// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../lib/db/test-client";
import { auditEvents, initiatives, runBudget, sessions, evidenceDocuments } from "../lib/db/schema";
import { exportDemoSql } from "./export-demo-sql";

describe("additive Meridian Health import", () => {
  let db: TestDb;
  let sql: string;
  beforeAll(async () => { sql = await exportDemoSql(); }, 30_000);
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await closeTestDb(db); });
  afterAll(() => { sql = ""; });

  async function snapshot() {
    const tables = ["initiatives", "audit_events", "run_budget", "sessions", "evidence_documents"];
    return Promise.all(tables.map(async (table) => (await db.$client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  }

  it("imports the complete portfolio and repeats without modifying visitor records or history", async () => {
    const now = new Date("2026-09-21T00:00:00Z");
    await db.insert(initiatives).values({ id: "visitor-case", slug: "visitor-case", title: "Visitor fiction", requester: "Priya Raman", state: "intake_draft", workspaceId: "visitor-a", createdAt: now, updatedAt: now });
    await db.insert(auditEvents).values({ id: "visitor-audit", initiativeId: "visitor-case", ts: now, actor: "Priya Raman", actorRole: "requester", action: "intake_drafted", detail: "Preserve this history." });
    await db.insert(runBudget).values({ id: "existing-budget", day: "2026-07-01", tokensUsed: 123, tokensCap: 500 });
    await db.insert(sessions).values({ token: "test-session", personaKey: "priya-raman", workspaceId: "visitor-a", expiresAt: now.getTime() + 86400000 });
    await db.insert(evidenceDocuments).values({ id: "visitor-evidence", initiativeId: "visitor-case", requestId: "doc-test", fileName: "fictional.txt", mediaType: "text/plain", byteSize: 1, content: Buffer.from("x"), sha256: "test", version: 1, uploadedBy: "priya-raman", createdAt: now });
    const before = await snapshot();
    await db.$client.exec(sql);
    const after = await snapshot();
    for (let i = 0; i < before.length; i++) expect(after[i]).toEqual(expect.arrayContaining(before[i]));
    expect(await db.select().from(initiatives)).toHaveLength(13);
    const counts = await db.$client.query<{ reviews: number; observations: number; decisions: number }>("SELECT (SELECT count(*)::int FROM review_decisions) reviews, (SELECT count(*)::int FROM observations) observations, (SELECT count(*)::int FROM initiative_decisions) decisions");
    expect(counts.rows[0].reviews).toBeGreaterThan(10);
    expect(counts.rows[0].observations).toBeGreaterThan(100);
    expect(counts.rows[0].decisions).toBeGreaterThan(1);
    await db.$client.exec(sql);
    expect(await snapshot()).toEqual(after);
    await expect(db.$client.exec("UPDATE audit_events SET detail = 'changed' WHERE id = 'visitor-audit'")).rejects.toThrow();
  });

  it("aborts atomically when a visitor owns one of the demo slugs", async () => {
    const now = new Date();
    await db.insert(initiatives).values({ id: "visitor-collision", slug: "prior-auth-summarizer", title: "Keep me", requester: "Priya Raman", state: "intake_draft", workspaceId: "visitor-a", createdAt: now, updatedAt: now });
    const before = await snapshot();
    await expect(db.$client.exec(sql)).rejects.toThrow(/conflict/i);
    await db.$client.exec("ROLLBACK");
    expect(await snapshot()).toEqual(before);
    expect((await db.$client.query("SELECT * FROM control_definitions")).rows).toHaveLength(0);
  });

  it("refuses a partial fixture instead of guessing how to repair it", async () => {
    await db.$client.exec(sql);
    await db.$client.exec("DELETE FROM observations WHERE id = (SELECT id FROM observations LIMIT 1)");
    const before = await snapshot();
    await expect(db.$client.exec(sql)).rejects.toThrow(/incomplete|conflict/i);
    await db.$client.exec("ROLLBACK");
    expect(await snapshot()).toEqual(before);
  });

  it("refuses modified global controls without overwriting them", async () => {
    await db.$client.exec(sql);
    await db.$client.exec("UPDATE control_definitions SET owner = 'Existing administrator' WHERE id = 'Q-01'");
    await expect(db.$client.exec(sql)).rejects.toThrow(/conflict in control_definitions/i);
    await db.$client.exec("ROLLBACK");
    const result = await db.$client.query<{owner: string}>("SELECT owner FROM control_definitions WHERE id = 'Q-01'");
    expect(result.rows[0].owner).toBe("Existing administrator");
  });

  it("refuses partial preexisting sample rows even if their values match", async () => {
    await db.$client.exec(sql);
    // Rebuild a fresh target with just one fixture initiative, no marker.
    const row = (await db.select().from(initiatives))[0];
    await closeTestDb(db);
    db = await createTestDb();
    await db.insert(initiatives).values(row);
    await expect(db.$client.exec(sql)).rejects.toThrow(/without import marker/i);
    await db.$client.exec("ROLLBACK");
    expect(await db.select().from(initiatives)).toEqual([row]);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("exports only additive business data without runtime accounting, credentials, or permission changes", () => {
    const statements = sql.replace(/'(?:''|[^'])*'/g, "''").replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\b(?:DELETE|UPDATE|TRUNCATE|ALTER|GRANT|REVOKE|DROP)\b/i);
    expect(sql).not.toMatch(/public\.(?:sessions|run_budget|rate_limit_buckets|evidence_documents|evidence_packets)/);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("meridian-demo-import-v1");
  });
});
