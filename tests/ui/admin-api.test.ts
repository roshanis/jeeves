// P3 admin/monitor API client helpers (lib/client/api.ts) — request shape +
// error mapping contract. Routes are read-only for the UI team; these tests
// pin the method/path/body/token the client sends and the typed ApiError it
// surfaces on failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isApiError,
  listIncidents,
  pauseDeployment,
  resumeDeployment,
  runMonitor,
  setThreshold,
} from "@/lib/client/api";

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

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("runMonitor", () => {
  it("POSTs an empty body (server default nowTs) when no timestamp is given", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { evaluated: 3, breaches: [], incidentsCreated: 0, alreadyKnown: 0 }),
    );
    const result = await runMonitor("tok-1");
    const { url, init, body } = lastCall();
    expect(url).toBe("/api/monitor/run");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(body).toEqual({});
    expect(result.evaluated).toBe(3);
  });

  it("serializes an explicit nowTs to ISO", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { evaluated: 1, breaches: [], incidentsCreated: 1, alreadyKnown: 0 }),
    );
    await runMonitor("tok-1", Date.parse("2026-07-15T00:00:00Z"));
    expect(lastCall().body).toEqual({ nowTs: "2026-07-15T00:00:00.000Z" });
  });

  it("maps a 429 budget/rate response to a typed ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: "rate limit" }));
    await expect(runMonitor("tok-1")).rejects.toSatisfy(
      (e: unknown) => isApiError(e) && e.status === 429,
    );
  });
});

describe("listIncidents", () => {
  it("GETs the public incidents route and unwraps the array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        incidents: [
          {
            id: "inc-1",
            deploymentId: "dep-4",
            controlId: "Q-01",
            windowStart: "2026-07-11T00:00:00.000Z",
            detectedAt: "2026-07-13T00:00:00.000Z",
            reviewCycleId: "cyc-9",
            resolvedAt: null,
          },
        ],
      }),
    );
    const rows = await listIncidents();
    const { url, init } = lastCall();
    expect(url).toBe("/api/monitor/incidents");
    expect(init.method).toBe("GET");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.controlId).toBe("Q-01");
  });
});

describe("setThreshold", () => {
  it("sends explicit null initiativeId for a tier-default change", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { controlId: "Q-01", scope: "tier-default", tier: "high", before: 0.08, after: 0.06 }),
    );
    await setThreshold("tok-admin", { controlId: "Q-01", tier: "high", value: 0.06, reason: "post-breach" });
    const body = lastCall().body;
    expect(body.initiativeId).toBeNull();
    expect(body.value).toBe(0.06);
    expect(body.reason).toBe("post-breach");
  });

  it("sends the initiativeId for a project override", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { controlId: "Q-01", scope: "project-override", initiativeId: "init-004", before: 0.08, after: 0.05 }),
    );
    await setThreshold("tok-admin", { controlId: "Q-01", initiativeId: "init-004", value: 0.05, reason: "tighten" });
    expect(lastCall().body.initiativeId).toBe("init-004");
  });

  it("maps a 403 (non-admin) to a typed ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    await expect(
      setThreshold("tok-x", { controlId: "Q-01", tier: "high", value: 0.06, reason: "x" }),
    ).rejects.toSatisfy((e: unknown) => isApiError(e) && e.status === 403);
  });
});

describe("pause / resume deployment", () => {
  it("pauseDeployment targets the initiative id and sends the reason", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { initiativeId: "init-004", deploymentId: "dep-4", before: "deployed", after: "paused" }),
    );
    await pauseDeployment("tok-admin", "init-004", "manual hold");
    const { url, init, body } = lastCall();
    expect(url).toBe("/api/admin/deployments/init-004/pause");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ reason: "manual hold" });
  });

  it("resumeDeployment hits the resume route", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { initiativeId: "init-004", deploymentId: "dep-4", before: "paused", after: "deployed" }),
    );
    await resumeDeployment("tok-admin", "init-004", "cleared");
    expect(lastCall().url).toBe("/api/admin/deployments/init-004/resume");
  });

  it("URL-encodes the initiative id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { initiativeId: "a/b", deploymentId: "d", before: "deployed", after: "paused" }),
    );
    await pauseDeployment("tok", "a/b", "r");
    expect(lastCall().url).toBe("/api/admin/deployments/a%2Fb/pause");
  });
});
