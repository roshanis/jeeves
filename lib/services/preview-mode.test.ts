// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(() => { throw new Error("Preview must not access the database"); }),
}));
vi.mock("@/lib/db/client", () => ({ getDb }));

import { POST } from "@/app/api/session/route";
import { GET as runScheduledMonitor } from "@/app/api/cron/monitor/route";
import { issueDemoSession, runMutationGuard } from "./route-guard";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { getDb.mockClear(); });

describe.each([
  ["mock", ""],
  ["mock", "postgresql://unused.invalid/preview-test"],
  [undefined, ""],
] as const)("read-only provider %s with database %s", (mode, databaseUrl) => {
  beforeEach(() => {
    vi.stubEnv("DATA_PROVIDER", mode);
    vi.stubEnv("DATABASE_URL", databaseUrl);
  });

  it("rejects session issuance before database access and never sets a workspace cookie", async () => {
    const response = await POST(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-passcode", personaKey: "priya-raman" }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("preview is read-only") });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects an existing bearer session before resolving it or consuming rate/budget state", async () => {
    const result = await runMutationGuard(new Request("http://localhost/api/initiatives", {
      method: "POST",
      headers: { authorization: "Bearer earlier-live-session" },
    }), undefined, { requiresBudget: true, estimatedTokens: 500 });
    expect(result).toMatchObject({ ok: false, failure: { kind: "read_only", status: 403, message: expect.stringContaining("preview is read-only") } });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("does not issue a session through the service helper", async () => {
    expect(await issueDemoSession("same-passcode", "same-passcode", "priya-raman")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects authenticated scheduled writes before database access while preserving cron authentication", async () => {
    vi.stubEnv("CRON_SECRET", "preview-cron-test-only");
    const unauthorized = await runScheduledMonitor(new Request("http://localhost/api/cron/monitor"));
    expect(unauthorized.status).toBe(401);
    const authorized = await runScheduledMonitor(new Request("http://localhost/api/cron/monitor", {
      headers: { authorization: "Bearer preview-cron-test-only" },
    }));
    expect(authorized.status).toBe(403);
    expect(await authorized.json()).toMatchObject({ error: expect.stringContaining("preview is read-only") });
    expect(getDb).not.toHaveBeenCalled();
  });
});
