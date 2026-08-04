// RunMonitorPanel (components/jeeves/run-monitor-panel.tsx) — P1 observability
// fix (external review): a monitor run where per-candidate persistence
// failures occurred must never render identically to a clean run. This
// suite drives the real "Run monitor" click -> POST /api/monitor/run flow
// (fetch mocked, same pattern as tests/ui/auditor-chat.test.tsx) rather than
// poking component state directly, so it also exercises the new
// `RunMonitorResultWithErrors` client-side typing end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import {
  LiveSessionProvider,
  resetLiveSessionForTests,
  useLiveSession,
} from "@/lib/client/session-context";
import { RunMonitorPanel } from "@/components/jeeves/run-monitor-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  resetLiveSessionForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLiveSessionForTests();
});

const CLEAN_RESULT = {
  evaluated: 6,
  breaches: [],
  incidentsCreated: 0,
  alreadyKnown: 0,
  errors: [],
};

const FAILED_RESULT = {
  evaluated: 6,
  breaches: [
    {
      initiativeId: "init-healthy",
      deploymentId: "dep-healthy",
      controlId: "Q-01",
      windowStartTs: 1000,
      identityKey: "dep-healthy:Q-01:1000",
      threshold: 0.08,
      breachingValues: [0.5, 0.6, 0.7],
      isNew: true,
      incidentId: "incident-1",
      reviewCycleId: "cycle-1",
    },
    {
      initiativeId: "init-failed",
      deploymentId: "dep-failed",
      controlId: "Q-01",
      windowStartTs: 2000,
      identityKey: "dep-failed:Q-01:2000",
      threshold: 0.08,
      breachingValues: [0.9, 0.9, 0.9],
      isNew: false,
      incidentId: "",
      reviewCycleId: null,
      failed: true,
    },
  ],
  incidentsCreated: 1,
  alreadyKnown: 0,
  errors: [
    {
      initiativeId: "init-failed",
      deploymentId: "dep-failed",
      message:
        "initiative init-failed (deployment dep-failed) has a Q-01 breach but no risk assessment on file",
    },
  ],
};

describe("RunMonitorPanel — no live session", () => {
  it("renders the disabled Run monitor button with no result summary", () => {
    renderWithProviders(<RunMonitorPanel />);
    const button = document.querySelector('[data-slot="run-monitor"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.querySelector('[data-slot="monitor-result"]')).toBeNull();
    expect(document.querySelector('[data-slot="monitor-errors"]')).toBeNull();
  });
});

describe("RunMonitorPanel — live session", () => {
  // Mirrors auditor-chat.test.tsx / demo-mode-chip.test.tsx's fetch-mocked
  // login flow: drive `login()` directly via a tiny capture component
  // mounted alongside RunMonitorPanel under one shared LiveSessionProvider.
  let capturedLogin: ((passcode: string, personaKey: string) => Promise<unknown>) | null = null;

  function LoginCapture() {
    const { login } = useLiveSession();
    capturedLogin = login;
    return null;
  }

  async function renderLoggedIn() {
    const utils = renderWithProviders(
      <LiveSessionProvider>
        <LoginCapture />
        <RunMonitorPanel />
      </LiveSessionProvider>,
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: "tok-live",
        workspaceId: "ws-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    await capturedLogin!("correct-pass", "ray-chen");

    return utils;
  }

  function clickRunMonitor() {
    const button = document.querySelector('[data-slot="run-monitor"]') as HTMLButtonElement;
    fireEvent.click(button);
  }

  it("clean run: renders the summary line without a FAILED marker and no errors block", async () => {
    await renderLoggedIn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, CLEAN_RESULT));

    clickRunMonitor();

    await waitFor(() => {
      expect(document.querySelector('[data-slot="monitor-result"]')).toBeTruthy();
    });

    const summary = document.querySelector('[data-slot="monitor-result"]') as HTMLElement;
    expect(summary.textContent).toContain("Evaluated 6");
    expect(summary.textContent).toContain("breaches 0");
    expect(summary.textContent).toContain("incidents created 0");
    expect(summary.textContent).not.toContain("FAILED");
    expect(summary.textContent).toContain("all candidates evaluated cleanly");

    expect(document.querySelector('[data-slot="monitor-errors"]')).toBeNull();
  });

  it("run with per-candidate failures (P1 fix): renders the failure count + per-candidate messages, and the summary never reads as a clean run", async () => {
    await renderLoggedIn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, FAILED_RESULT));

    clickRunMonitor();

    await waitFor(() => {
      expect(document.querySelector('[data-slot="monitor-errors"]')).toBeTruthy();
    });

    // Preserved existing slot, and it must NOT read as a clean run.
    const summary = document.querySelector('[data-slot="monitor-result"]') as HTMLElement;
    expect(summary).toBeTruthy();
    expect(summary.textContent).toContain("FAILED");
    expect(summary.textContent).not.toContain("all candidates evaluated cleanly");
    expect(summary.textContent).toContain("incidents created 1");
    // 2 detected breaches (one persisted, one failed) but only 1 incident.
    expect(summary.textContent).toContain("breaches 2");

    // New errors block: count + per-candidate message, warning tint tokens
    // (app/globals.css status-warning tokens, not raw Tailwind colors).
    const errorsBlock = document.querySelector('[data-slot="monitor-errors"]') as HTMLElement;
    expect(errorsBlock.textContent).toContain("1 candidate");
    expect(errorsBlock.textContent).toContain("init-failed");
    expect(errorsBlock.textContent).toContain("dep-failed");
    expect(errorsBlock.textContent).toContain("no risk assessment on file");
    expect(errorsBlock.className).toContain("bg-status-warning-bg");
    expect(errorsBlock.className).toContain("text-status-warning-fg");
  });
});
