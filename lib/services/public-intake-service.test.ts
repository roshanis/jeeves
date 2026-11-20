import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { initiatives, intakeVersions } from "../db/schema";
import { listPublicSubmissions, PUBLIC_QUEUE_LIMIT } from "./public-intake-service";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await closeTestDb(db);
});

describe("listPublicSubmissions", () => {
  it("uses one query and returns only the newest PUBLIC_QUEUE_LIMIT rows, with the latest intake version", async () => {
    const total = PUBLIC_QUEUE_LIMIT + 5;
    const base = Date.parse("2026-01-01T00:00:00Z");
    const initRows = Array.from({ length: total }, (_, i) => ({
      id: `i${i}`,
      slug: `s${i}`,
      title: `T${i}`,
      requester: "Visitor",
      state: "draft",
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + i * 1000),
      workspaceId: `public-ws_${i}`,
    }));
    await db.insert(initiatives).values(initRows);
    const iv = (id: string, version: number, problem: string, submitted: boolean) => ({
      id: `${id}-v${version}`,
      initiativeId: id,
      version,
      submitted,
      fields: { basics: { requesterEmail: "a@example.test", businessProblem: problem } },
      createdAt: new Date(base + Number(id.slice(1)) * 1000),
    });
    const newest = `i${total - 1}`;
    await db.insert(intakeVersions).values([
      iv(newest, 1, "old problem", false),
      iv(newest, 2, "latest problem", true),
      // Every other row was submitted once; i5 is a draft that never was.
      ...Array.from({ length: total - 1 }, (_, i) => iv(`i${i}`, 1, "p", i !== 5)),
    ] as never);

    const spy = vi.spyOn(db, "select");
    const out = await listPublicSubmissions(db);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(PUBLIC_QUEUE_LIMIT);
    expect(out[0].initiativeId).toBe(newest);
    expect(out[0].businessProblem).toBe("latest problem");
    // The submitted time is the first submitted version's, not the row's creation time.
    expect(out[0].submittedAt).toBe(new Date(base + (total - 1) * 1000).toISOString());
    expect(out.some((r) => r.initiativeId === "i0")).toBe(false);
  });

  it("does not list a draft that was never submitted", async () => {
    const at = new Date("2026-02-01T00:00:00Z");
    await db.insert(initiatives).values(["draft-only", "sent"].map((id) => ({
      id, slug: id, title: id, requester: "Visitor", state: "draft", createdAt: at, updatedAt: at, workspaceId: `public-ws_${id}`,
    })));
    const fields = { basics: { requesterEmail: "a@example.test", businessProblem: "p" } };
    await db.insert(intakeVersions).values([
      { id: "d1", initiativeId: "draft-only", version: 1, submitted: false, fields, createdAt: at },
      { id: "s1", initiativeId: "sent", version: 1, submitted: true, fields, createdAt: new Date("2026-02-02T00:00:00Z") },
    ] as never);
    const out = await listPublicSubmissions(db);
    expect(out.map((r) => r.initiativeId)).toEqual(["sent"]);
    expect(out[0].submittedAt).toBe("2026-02-02T00:00:00.000Z");
  });
});
