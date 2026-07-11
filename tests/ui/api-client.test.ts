// Typed API client (lib/client/api.ts) — error mapping contract tests.
// The route contract (app/api/** — read-only for the UI team) always returns
// `{ error: string, ... }` with status 401/429/400/403/404 on failure; the
// client must surface a typed ApiError and map statuses to stable UX copy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiErrorToMessage,
  createInitiative,
  decide,
  getDraftRunProgress,
  isApiError,
  postSession,
  returnReview,
  runTriage,
  signReview,
  startDraftRun,
  submitIntake,
} from "@/lib/client/api";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postSession", () => {
  it("returns the session on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: "tok-1", workspaceId: "ws-1", expiresAt: 123 }),
    );
    const session = await postSession("pass", "priya-raman");
    expect(session).toEqual({ token: "tok-1", workspaceId: "ws-1", expiresAt: 123 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/session");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      passcode: "pass",
      personaKey: "priya-raman",
    });
  });

  it("throws ApiError(401) on a wrong passcode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
    await expect(postSession("wrong", "priya-raman")).rejects.toMatchObject({
      status: 401,
      message: "unauthorized",
    });
  });
});

describe("authenticated helpers send the Bearer token", () => {
  it("createInitiative sends Authorization and the payload envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { initiativeId: "init-1", slug: "s-1", intakeVersionId: "iv-1" }),
    );
    const result = await createInitiative("tok-9", CHAMPION_PREFILL_PAYLOAD);
    expect(result.initiativeId).toBe("init-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/initiatives");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-9");
    expect(JSON.parse(init.body as string).payload.basics.title).toBe(
      "Prior-Auth Clinical Summarizer",
    );
  });

  it.each([
    ["submitIntake", () => submitIntake("tok", "init-1"), "/api/initiatives/init-1/submit"],
    ["runTriage", () => runTriage("tok", "init-1"), "/api/initiatives/init-1/triage"],
    [
      "startDraftRun",
      () => startDraftRun("tok", "init-1", ["legal"]),
      "/api/initiatives/init-1/draft-run",
    ],
    [
      "signReview",
      () => signReview("tok", "cycle-1", "privacy-hipaa"),
      "/api/reviews/cycle-1/privacy-hipaa/sign",
    ],
    [
      "returnReview",
      () => returnReview("tok", "cycle-1", "legal", "needs work"),
      "/api/reviews/cycle-1/legal/return",
    ],
    [
      "decide",
      () => decide("tok", "init-1", { decision: "approved" }),
      "/api/initiatives/init-1/decide",
    ],
  ])("%s posts to the right route with the token", async (_name, call, expectedUrl) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await call();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expectedUrl);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("getDraftRunProgress is a public GET keyed by cycleId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { cycleId: "c1", rows: [], complete: false }),
    );
    const progress = await getDraftRunProgress("init-1", "c1");
    expect(progress.complete).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("/api/initiatives/init-1/draft-run?cycleId=c1");
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("error mapping", () => {
  it("maps 401 to a typed ApiError and re-auth message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "invalid or missing session" }),
    );
    const err = await runTriage("stale", "init-1").catch((e) => e);
    expect(isApiError(err)).toBe(true);
    expect(err.status).toBe(401);
    expect(apiErrorToMessage(err)).toBe(
      "Session expired or invalid — enter the demo passcode again.",
    );
  });

  it("maps 429 (rate limit or budget) to the retry message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: "rate limit exceeded", retryAfterSeconds: 30 }),
    );
    const err = await startDraftRun("tok", "init-1", ["legal"]).catch((e) => e);
    expect(err.status).toBe(429);
    expect(apiErrorToMessage(err)).toBe(
      "Rate limit or demo budget reached — try again shortly.",
    );
  });

  it("maps 403 to the role message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: "only requesters may create an intake draft" }),
    );
    const err = await createInitiative("tok", CHAMPION_PREFILL_PAYLOAD).catch((e) => e);
    expect(err.status).toBe(403);
    expect(apiErrorToMessage(err)).toBe("Not permitted for your current role.");
  });

  it("surfaces the server's own message (and gaps) for 400", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: "input validation failed",
        gaps: [{ field: "reason", maxChars: 2000 }],
      }),
    );
    const err = await returnReview("tok", "c1", "legal", "x".repeat(3000)).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.gaps).toHaveLength(1);
    expect(apiErrorToMessage(err)).toBe("input validation failed");
  });

  it("falls back to a generic message for unexpected statuses and non-JSON bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const err = await submitIntake("tok", "init-1").catch((e) => e);
    expect(isApiError(err)).toBe(true);
    expect(err.status).toBe(500);
    expect(apiErrorToMessage(err)).toBe("Something went wrong — please try again.");
  });

  it("isApiError rejects non-ApiError values", () => {
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError(new ApiError(401, "x"))).toBe(true);
  });
});
