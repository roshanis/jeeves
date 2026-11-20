/**
 * One mapping for IllegalTransitionError on every workflow route (L31):
 * 403 for a role violation, 409 for a request in the wrong state, 400 for a
 * missing reason. The service layer is stubbed so each test controls which
 * kind of error the route sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { IllegalTransitionError, type IllegalTransitionKind } from "@/lib/lifecycle/transitions";

let testDb: TestDb;
const svc = vi.hoisted(() => ({ decide: vi.fn(), startQc: vi.fn(), decideException: vi.fn(), signReview: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));
vi.mock("@/lib/services/initiative-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/initiative-service")>()),
  decide: svc.decide,
  startQc: svc.startQc,
  signReview: svc.signReview,
}));
vi.mock("@/lib/services/exception-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/exception-service")>()),
  decideException: svc.decideException,
}));

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = "test-only-workspace-cookie-secret";
  testDb = await createTestDb();
  Object.values(svc).forEach((m) => m.mockReset());
});
afterEach(async () => {
  await closeTestDb(testDb);
});

async function token(personaKey: string): Promise<string> {
  const { POST } = await import("../session/route");
  const res = await POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personaKey }),
    }),
  );
  return ((await res.json()) as { token: string }).token;
}

const headers = (t: string, ip: string): HeadersInit => ({ authorization: `Bearer ${t}`, "x-forwarded-for": ip, "content-type": "application/json" });
const illegal = (kind: IllegalTransitionKind) => new IllegalTransitionError("x", "in_review", "approve", "approver", kind);

const CASES: Array<[IllegalTransitionKind, number]> = [["role", 403], ["state", 409], ["reason", 400]];
const CODES: Record<IllegalTransitionKind, string> = { role: "NOT_PERMITTED", state: "INVALID_STATE", reason: "REASON_REQUIRED" };

describe("IllegalTransitionError status mapping", () => {
  it.each(CASES)("decide route: %s -> %i", async (kind, status) => {
    svc.decide.mockRejectedValue(illegal(kind));
    const { POST } = await import("../initiatives/[id]/decide/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives/init-a/decide", { method: "POST", headers: headers(await token("angela-torres"), `60.${status}.0.1`), body: JSON.stringify({ decision: "approved" }) }),
      { params: Promise.resolve({ id: "init-a" }) },
    );
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBeTruthy();
    // A client tells "not allowed", "already done" and "say why" apart by code, not by parsing the message.
    expect(body.code).toBe(CODES[kind]);
  });

  it.each(CASES)("qc route: %s -> %i", async (kind, status) => {
    svc.startQc.mockRejectedValue(illegal(kind));
    const { POST } = await import("../initiatives/[id]/qc/route");
    const res = await POST(
      new Request("http://localhost/api/initiatives/init-a/qc", { method: "POST", headers: headers(await token("nia-okafor"), `61.${status}.0.1`) }),
      { params: Promise.resolve({ id: "init-a" }) },
    );
    expect(res.status).toBe(status);
  });

  it.each(CASES)("exception decide route: %s -> %i", async (kind, status) => {
    svc.decideException.mockRejectedValue(illegal(kind));
    const { POST } = await import("../exceptions/[id]/decide/route");
    const res = await POST(
      new Request("http://localhost/api/exceptions/exc-a/decide", { method: "POST", headers: headers(await token("angela-torres"), `62.${status}.0.1`), body: JSON.stringify({ approve: true, reason: "ok" }) }),
      { params: Promise.resolve({ id: "exc-a" }) },
    );
    expect(res.status).toBe(status);
  });

  it.each(CASES)("review sign route: %s -> %i", async (kind, status) => {
    svc.signReview.mockRejectedValue(illegal(kind));
    const { POST } = await import("../reviews/[cycleId]/[domain]/sign/route");
    const res = await POST(
      new Request("http://localhost/api/reviews/cycle-a/security/sign", { method: "POST", headers: headers(await token("devon-clarke"), `63.${status}.0.1`), body: JSON.stringify({ expectedRevision: 0, expectedEvidencePacketId: null }) }),
      { params: Promise.resolve({ cycleId: "cycle-a", domain: "security" }) },
    );
    expect(res.status).toBe(status);
  });
});
