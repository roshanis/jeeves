/**
 * HTTP-layer tests for GET /api/cron/monitor — authenticated, idempotent
 * scheduled monitoring (M3). Auth is a CRON_SECRET bearer, NOT a demo
 * session; a scheduled breach must create exactly one incident + reassessment
 * and a repeat run must be a no-op (idempotency).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { seedDatabase } from "@/scripts/seed";
import { initiatives } from "@/lib/db/schema";

let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

const CRON_SECRET = "cron-secret-for-tests";

beforeEach(async () => {
  testDb = await createTestDb();
  await seedDatabase(testDb);
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.CRON_SECRET;
});

function cronReq(secret: string | null): Request {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["authorization"] = `Bearer ${secret}`;
  return new Request("http://localhost/api/cron/monitor", { method: "GET", headers });
}

describe("GET /api/cron/monitor", () => {
  it("503s when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("../monitor/route");
    const res = await GET(cronReq(CRON_SECRET));
    expect(res.status).toBe(503);
  });

  it("401s a missing or wrong bearer", async () => {
    const { GET } = await import("../monitor/route");
    expect((await GET(cronReq(null))).status).toBe(401);
    expect((await GET(cronReq("wrong-secret"))).status).toBe(401);
  });

  it("runs on the schedule replay point and creates exactly one incident + reassessment", async () => {
    const { GET } = await import("../monitor/route");
    const res = await GET(cronReq(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.incidentsCreated).toBe(1);

    const [breached] = await testDb
      .select()
      .from(initiatives)
      .where(eq(initiatives.slug, "member-chat-copilot"));
    expect(breached!.state).toBe("re_review");
  });

  it("is idempotent — a repeat scheduled run creates no new incident", async () => {
    const { GET } = await import("../monitor/route");
    const first = await GET(cronReq(CRON_SECRET));
    expect((await first.json()).incidentsCreated).toBe(1);

    const second = await GET(cronReq(CRON_SECRET));
    expect(second.status).toBe(200);
    // Idempotency guarantee: zero NEW incidents on re-run (the first run paused
    // the deployment, so it is no longer re-evaluated — but crucially nothing
    // new is created).
    expect((await second.json()).incidentsCreated).toBe(0);
  });

  it("400s an invalid nowTs override", async () => {
    const { GET } = await import("../monitor/route");
    const res = await GET(
      new Request("http://localhost/api/cron/monitor?nowTs=not-a-date", {
        method: "GET",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(400);
  });
});
