// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { createDraft } from "../services/initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { DbDataProvider } from "./db-provider";

describe("stored live intake read model", () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await closeTestDb(db); });

  it("projects nested answers before triage consistently in list, detail and auditor results", async () => {
    const payload = {
      ...CHAMPION_PREFILL_PAYLOAD,
      overlay: { ...CHAMPION_PREFILL_PAYLOAD.overlay, humanInTheLoop: true, vendorHosted: false },
    };
    const created = await createDraft(db, {
      payload, requesterActor: { id: "priya-raman", role: "requester" },
      requesterName: "Priya Raman", workspaceId: "nested-intake-test",
    });
    const provider = new DbDataProvider(db);
    const scope = { viewerWorkspaceId: "nested-intake-test" };
    const expected = {
      phi: true, memberFacing: true, careCoverageInfluence: true,
      humanInLoop: true, individualImpact: true, vendorHosted: false,
    };
    const [summary] = await provider.listInitiatives(scope);
    expect(summary.flags).toEqual(expected);
    const detail = await provider.getInitiativeDetail(created.slug, scope);
    expect(detail?.summary.flags).toEqual(expected);
    expect(detail?.intake?.fields).toMatchObject(payload);
    expect((await provider.auditQuery("member-facing-phi", scope)).map((row) => row.slug))
      .toContain(created.slug);
    expect(await provider.getInitiativeDetail(created.slug, { viewerWorkspaceId: null })).toBeNull();
  });
});
