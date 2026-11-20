/**
 * Monitoring and Administration in production.
 *
 * Telemetry has no source in a production install yet (the monitor and the
 * cron routes answer 404, and there is no ingest), so the pages must not
 * present the demo's illustrative telemetry, the generated "synthetic traces"
 * connector card or a "Run monitor" button that would hit a 404. Incidents are
 * real database rows and stay.
 *
 * Demo is untouched; tests/ui/monitoring-state.test.tsx covers its output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import { MockDataProvider } from "@/lib/data/mock-provider";
import type { InitiativeDetail } from "@/lib/data/dto";
import type { IncidentLoadResult } from "@/app/_lib/incident-data";
import AdminPage from "@/app/(console)/admin/page";
import MonitoringPage, { generateMetadata } from "@/app/(console)/monitoring/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_lib/incident-data", () => ({
  loadIncidentsForViewer: async () => state.incidentResult,
}));

const state = vi.hoisted(() => ({
  detail: null as InitiativeDetail | null,
  incidentResult: { status: "success", incidents: [] } as IncidentLoadResult,
}));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => "workspace-prod",
  getAppProvider: () => ({
    controlCatalog: async () => [],
    auditQuery: async () => [],
    listInitiatives: async () => [state.detail!.summary],
    getInitiativeDetail: async () => state.detail,
    listInitiativeDetails: async () => [state.detail!],
  }),
}));

beforeEach(async () => {
  installResizeObserverStub();
  state.incidentResult = { status: "success", incidents: [] };
  const example = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
  state.detail = example!;
});
afterEach(() => vi.unstubAllEnvs());

const SYNTHETIC = /synthetic|illustrative|arize|fictional/i;

describe("Monitoring in production", () => {
  beforeEach(() => vi.stubEnv("JEEVES_MODE", undefined));

  it("shows no deployment telemetry, connector card, cost or GPU panel, and no synthetic label", async () => {
    const { container } = renderWithProviders(await MonitoringPage());
    expect(container.textContent).not.toMatch(SYNTHETIC);
    expect(container.querySelector('[data-slot="telemetry-connector-card"]')).toBeNull();
    expect(container.querySelector('[data-slot="cost-budget-card"]')).toBeNull();
    expect(container.querySelector('[data-slot="gpu-quota-card"]')).toBeNull();
    expect(screen.queryByText("Eval (hallucination)")).toBeNull();
  });

  it("says plainly that telemetry is not connected", async () => {
    renderWithProviders(await MonitoringPage());
    expect(screen.getByRole("status").textContent).toMatch(/telemetry is not connected/i);
  });

  it("keeps incidents, which are real rows, without pointing at a monitor that is switched off", async () => {
    const { container } = renderWithProviders(await MonitoringPage());
    expect(screen.getByText(/No incidents recorded/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/run the monitor/i);
  });

  it("describes the page without the synthetic-telemetry disclaimer", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Deployed model health");
    expect(String(metadata.description)).not.toMatch(SYNTHETIC);
  });
});

describe("Monitoring in demo", () => {
  beforeEach(() => vi.stubEnv("JEEVES_MODE", "demo"));

  it("keeps the synthetic-labelled telemetry panels", async () => {
    renderWithProviders(await MonitoringPage());
    expect(screen.getAllByText("Synthetic data — demo").length).toBeGreaterThan(0);
    expect(screen.getByText("Telemetry connector")).toBeTruthy();
  });

  it("keeps the synthetic-telemetry disclaimer in the description", async () => {
    expect(String((await generateMetadata()).description)).toMatch(/Synthetic telemetry — demo data\./);
  });
});

describe("Administration in production", () => {
  it("offers no Run monitor panel: the route behind it answers 404", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const { container } = renderWithProviders(await AdminPage());
    expect(screen.queryByText("Run monitor")).toBeNull();
    expect(container.querySelector('[data-slot="run-monitor-panel"]')).toBeNull();
    expect(screen.getByText(/Q-01 · Eval-quality floor/)).toBeTruthy();
  });

  it("keeps it in demo", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    renderWithProviders(await AdminPage());
    expect(screen.getAllByText("Run monitor").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="run-monitor-panel"]')).not.toBeNull();
  });
});
