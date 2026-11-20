// @vitest-environment node
/**
 * The privacy page promises that, on request, the content of a submitted
 * request is removed while the audit log keeps a record that it existed
 * (d09). This test runs the operator's removal SQL exactly as docs/deploy.md
 * prints it against a real submitted public request in PGlite, so the promise
 * cannot drift from what the database allows (append-only triggers, foreign
 * keys).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "@/lib/db/test-client";
import { listPublicSubmissions } from "@/lib/services/public-intake-service";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = "request-removal-test-secret";
  process.env.OPERATOR_TOKEN = "op-test-token-0123456789abcdefghijklmnop";
  testDb = await createTestDb();
});
afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
  delete process.env.OPERATOR_TOKEN;
});

const TYPED = {
  title: "Removal Test Title",
  name: "Riley Removal",
  email: "riley.removal@example.test",
  problem: "UNIQUE-BUSINESS-PROBLEM typed by a stranger about their own situation.",
  rollout: "UNIQUE-ROLLOUT-PLAN with enough words to pass the length rule on submit.",
  vendor: "UNIQUE-VENDOR-NAME",
};

const PAYLOAD = {
  basics: {
    title: TYPED.title,
    sponsorOrg: "Member Services",
    requesterName: TYPED.name,
    requesterEmail: TYPED.email,
    businessProblem: TYPED.problem,
  },
  useCase: { primaryUsers: "Coordinators", decisionInformed: "Who to call", expectedVolume: "1k-10k/mo" },
  data: {
    dataSources: ["Scheduling system"],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: "Inference-only",
  },
  modelVendor: { buildOrBuy: "Buy (vendor)", vendorName: TYPED.vendor, hosting: "Vendor-hosted", modelType: "LLM (generative)" },
  populationImpact: { affectedPopulations: ["Members"], expectedBenefits: "Fewer missed visits.", expectedHarms: "A wrong reminder." },
  deployment: { integrationPoints: ["Outreach queue"], rolloutPlan: TYPED.rollout },
  overlay: {
    touchesPHI: false,
    memberFacing: true,
    careCoverageInfluence: false,
    vendorHosted: true,
    humanInTheLoop: true,
    individualImpact: false,
  },
  evidenceAttachments: [],
};

async function submitPublicRequest(ip: string): Promise<{ initiativeId: string; workspaceId: string }> {
  const { POST: mint } = await import("@/app/api/public-session/route");
  const minted = await mint(
    new Request("http://localhost/api/public-session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
  const { token, workspaceId } = (await minted.json()) as { token: string; workspaceId: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": ip };
  const { POST: create } = await import("@/app/api/initiatives/route");
  const created = await create(
    new Request("http://localhost/api/initiatives", {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: PAYLOAD, requestId: `public-intake-${ip.replace(/\./g, "")}` }),
    }),
  );
  const { initiativeId } = (await created.json()) as { initiativeId: string };
  const { POST: submit } = await import("@/app/api/initiatives/[id]/submit/route");
  const submitted = await submit(
    new Request(`http://localhost/api/initiatives/${initiativeId}/submit`, { method: "POST", headers, body: "{}" }),
    { params: Promise.resolve({ id: initiativeId }) },
  );
  expect(submitted.status).toBe(200);
  return { initiativeId, workspaceId };
}

/** The statements between the marker comment and the end of the next sql fence in docs/deploy.md. */
function removalStatements(): string[] {
  const doc = readFileSync("docs/deploy.md", "utf8");
  const marker = doc.indexOf("<!-- request-removal-sql -->");
  expect(marker, "docs/deploy.md must carry the request-removal-sql block").toBeGreaterThan(-1);
  const open = doc.indexOf("```sql", marker);
  const close = doc.indexOf("```", open + 6);
  const body = doc.slice(open + 6, close);
  return body
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/:'ws'/g, "$1"));
}

async function dumpAll(): Promise<string> {
  const tabs = await testDb.$client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
  );
  const out: string[] = [];
  for (const { table_name } of tabs.rows) {
    const rows = await testDb.$client.query<{ j: string }>(`select to_jsonb(t)::text as j from "${table_name}" t`);
    out.push(...rows.rows.map((r) => `${table_name}: ${r.j}`));
  }
  return out.join("\n");
}

describe("removing the content of a real request (d09)", () => {
  it("clears what was typed, keeps the audit rows with the title, and no trigger blocks it", async () => {
    const mine = await submitPublicRequest("81.0.0.1");
    const other = await submitPublicRequest("81.0.0.2");

    const before = await dumpAll();
    for (const typed of [TYPED.name, TYPED.email, TYPED.problem, TYPED.rollout, TYPED.vendor]) {
      expect(before).toContain(typed);
    }
    const auditBefore = await testDb.$client.query<{ id: string }>(
      "select id from audit_events where initiative_id = $1 order by id",
      [mine.initiativeId],
    );
    expect(auditBefore.rows.length).toBeGreaterThan(0);

    for (const statement of removalStatements()) {
      await testDb.$client.query(statement, statement.includes("$1") ? [mine.workspaceId] : []);
    }

    // Only the first request's workspace was named, so only its content went.
    const queue = await listPublicSubmissions(testDb);
    const removed = queue.find((r) => r.initiativeId === mine.initiativeId)!;
    const untouched = queue.find((r) => r.initiativeId === other.initiativeId)!;
    expect(removed.requesterEmail).toBeNull();
    expect(removed.businessProblem).toBeNull();
    expect(removed.requester).not.toContain(TYPED.name);
    expect(untouched.requesterEmail).toBe(TYPED.email);
    expect(untouched.requester).toBe(TYPED.name);

    const after = await testDb.$client.query<{ j: string }>(
      `select to_jsonb(t)::text as j from intake_versions t where initiative_id = $1
       union all select to_jsonb(t)::text from initiatives t where id = $1`,
      [mine.initiativeId],
    );
    const remaining = after.rows.map((r) => r.j).join("\n");
    for (const typed of [TYPED.name, TYPED.email, TYPED.problem, TYPED.rollout, TYPED.vendor]) {
      expect(remaining).not.toContain(typed);
    }

    // The audit log is untouched: same rows, and the title is still in it.
    const auditAfter = await testDb.$client.query<{ id: string; detail: string }>(
      "select id, detail from audit_events where initiative_id = $1 order by id",
      [mine.initiativeId],
    );
    expect(auditAfter.rows.map((r) => r.id)).toEqual(auditBefore.rows.map((r) => r.id));
    expect(auditAfter.rows.some((r) => r.detail.includes(TYPED.title))).toBe(true);
    expect(removed.title).toBe(TYPED.title);
  });
});
