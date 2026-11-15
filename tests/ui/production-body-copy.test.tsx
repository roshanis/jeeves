/**
 * Page bodies, like the metadata, must not carry the demo's fictional payer,
 * fictional reviewer names or the promotion story into a production install.
 * Demo copy is pinned unchanged beside each production case.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { installResizeObserverStub, renderWithProviders } from "./helpers";
import PortfolioPage from "@/app/(console)/portfolio/page";
import ControlsPage from "@/app/(console)/controls/page";
import AgentsPage from "@/app/(console)/agents/page";
import AgentPage from "@/app/(console)/agents/[id]/page";
import AdminPage from "@/app/(console)/admin/page";
import { EvalsTab } from "@/components/jeeves/operate-tab";
import { MockDataProvider } from "@/lib/data/mock-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/jeeves/outcome-metrics-strip", () => ({ OutcomeMetricsStrip: () => null }));
vi.mock("@/components/jeeves/risk-heatmap", () => ({ RiskHeatmap: () => null }));
vi.mock("@/components/jeeves/portfolio-view", () => ({ PortfolioView: () => null }));
vi.mock("@/components/jeeves/control-catalog", () => ({ ControlCatalog: () => null }));
vi.mock("@/components/jeeves/exceptions-panel", () => ({ ExceptionsPanel: () => null }));
vi.mock("@/components/jeeves/agent-connection-test", () => ({ AgentConnectionTest: () => null }));
vi.mock("@/lib/services/require-viewer", () => ({ requireViewer: async () => ({}) }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => "workspace-1",
  getAppProvider: () => ({
    listInitiatives: async () => [],
    outcomeMetrics: async () => ({}),
    controlCatalog: async () => [],
    auditQuery: async () => [],
  }),
}));
vi.mock("@/app/_lib/portfolio-data", () => ({ loadPortfolioDetails: async () => [] }));
vi.mock("@/app/_lib/incident-data", () => ({ loadIncidentsForViewer: async () => ({ incidents: [] }) }));
vi.mock("@/components/jeeves/run-monitor-panel", () => ({ RunMonitorPanel: () => null }));
vi.mock("@/components/jeeves/threshold-edit-action", () => ({ ThresholdEditAction: () => null }));
vi.mock("@/components/jeeves/deployment-action-button", () => ({ DeploymentActionButton: () => null }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/exception-service", () => ({ listExceptions: async () => [] }));

beforeAll(() => installResizeObserverStub());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function inMode(mode: "demo" | "production") {
  vi.stubEnv("JEEVES_MODE", mode === "demo" ? "demo" : undefined);
}

// The detail page also prints the agent's own instruction file, which names its persona: only the reviewer line is in scope.
const reviewerOf = (text: string | null) => /Accountable reviewer:(.*?)Policy:/.exec(text ?? "")?.[1] ?? "";

describe("page bodies by deployment mode", () => {
  it("portfolio names the fictional payer only in demo", async () => {
    inMode("demo");
    expect(renderWithProviders(await PortfolioPage(), { mode: "demo" }).container.textContent).toContain("Every Meridian Health AI initiative");
    cleanup();
    inMode("production");
    const text = renderWithProviders(await PortfolioPage(), { mode: "production" }).container.textContent;
    expect(text).not.toContain("Meridian");
    expect(text).toContain("Every AI initiative");
  });

  it("controls names the fictional payer only in demo", async () => {
    inMode("demo");
    expect(renderWithProviders(await ControlsPage(), { mode: "demo" }).container.textContent).toContain("Every governance control Meridian enforces");
    cleanup();
    inMode("production");
    const text = renderWithProviders(await ControlsPage(), { mode: "production" }).container.textContent;
    expect(text).not.toContain("Meridian");
    expect(text).toContain("Every governance control enforced, across every domain");
  });

  it("admin does not hard-code the critical-tier default in production", async () => {
    inMode("demo");
    expect(renderWithProviders(await AdminPage(), { mode: "demo" }).container.textContent).toContain("Critical-tier default0.05");
    cleanup();
    inMode("production");
    const text = renderWithProviders(await AdminPage(), { mode: "production" }).container.textContent;
    expect(text).not.toContain("Critical-tier default0.05");
    expect(text).toContain("Critical-tier defaultPer control definition");
  });

  it("agents list shows fictional reviewers only in demo", async () => {
    inMode("demo");
    expect(renderWithProviders(await AgentsPage(), { mode: "demo" }).container.textContent).toContain("James Liu");
    cleanup();
    inMode("production");
    const text = renderWithProviders(await AgentsPage(), { mode: "production" }).container.textContent ?? "";
    expect(text).not.toContain("James Liu");
    expect(text).toContain("Rotational");
  });

  it("agent page shows a fictional reviewer only in demo", async () => {
    const props = { params: Promise.resolve({ id: "reviewer-legal" }) };
    inMode("demo");
    expect(reviewerOf(renderWithProviders(await AgentPage(props), { mode: "demo" }).container.textContent)).toContain("James Liu");
    cleanup();
    inMode("production");
    const reviewer = reviewerOf(renderWithProviders(await AgentPage(props), { mode: "production" }).container.textContent);
    expect(reviewer).not.toContain("James Liu");
    expect(reviewer).toContain("Rotational");
  });

  it("the promotion-gate alert is a demo story", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("pa-correspondence-model");
    const demo = renderWithProviders(<EvalsTab slug="pa-correspondence-model" telemetry={detail!.telemetry} />, { mode: "demo" });
    expect(demo.container.textContent).toContain("Promotion gate");
    cleanup();
    const prod = renderWithProviders(<EvalsTab slug="pa-correspondence-model" telemetry={detail!.telemetry} />, { mode: "production" });
    expect(prod.container.textContent).not.toContain("Promotion gate");
  });
});
