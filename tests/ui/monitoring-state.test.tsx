import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import { MockDataProvider } from "@/lib/data/mock-provider";
import type { InitiativeDetail } from "@/lib/data/dto";
import type { IncidentLoadResult } from "@/app/_lib/incident-data";
import InboxPage from "@/app/(console)/inbox/page";
import AdminPage from "@/app/(console)/admin/page";
import MonitoringPage from "@/app/(console)/monitoring/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_lib/incident-data", () => ({
  loadIncidentsForViewer: async () => state.incidentResult,
}));
vi.mock("@/components/jeeves/role-aware-inbox", () => ({
  RoleAwareInbox: ({ evalBreaches, incidentCount }: { evalBreaches: unknown[]; incidentCount: number | null }) => <div data-testid="inbox-signals" data-eval-count={evalBreaches.length} data-incident-count={incidentCount ?? "unavailable"} />,
}));

const state = vi.hoisted(() => ({
  detail: null as InitiativeDetail | null,
  incidentResult: { status: "unavailable", reason: "preview", incidents: null } as IncidentLoadResult,
}));
afterEach(() => vi.unstubAllEnvs());
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => null,
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
  vi.stubEnv("DATA_PROVIDER", "mock");
  state.incidentResult = { status: "unavailable", reason: "preview", incidents: null };
  const example = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
  state.detail = {
    ...example!,
    telemetry: [{
      kind: "eval_hallucination", threshold: 0.08,
      points: [{ ts: "2026-09-01T00:00:00Z", value: 0.12 }, { ts: "2026-09-02T00:00:00Z", value: 0.04 }],
    }],
  };
});

describe("Monitoring truthfulness", () => {
  it("does not keep recovered readings in the requester-independent Inbox signal set", async () => {
    renderWithProviders(await InboxPage());
    expect(screen.getByTestId("inbox-signals").getAttribute("data-eval-count")).toBe("0");
    expect(screen.getByTestId("inbox-signals").getAttribute("data-incident-count")).toBe("unavailable");
    expect(screen.queryByText(/Incident data unavailable|no connected incident store/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps unavailable incident data explicit in Administration", async () => {
    renderWithProviders(await AdminPage());
    expect(screen.getByRole("status").textContent).toBe("Incident records are not included in this preview.");
    expect(screen.queryByText(/No incidents recorded/i)).toBeNull();
    expect(screen.queryByText(/Last changed 30 days ago/i)).toBeNull();
  });
  it("does not label a recovered latest reading as over threshold", async () => {
    renderWithProviders(await MonitoringPage());
    expect(screen.getByText("0.040")).toBeTruthy();
    expect(screen.queryByText(/over floor|above threshold/i)).toBeNull();
  });

  it("distinguishes preview incident data from a verified empty incident list", async () => {
    renderWithProviders(await MonitoringPage());
    expect(screen.queryByText(/No incidents recorded/)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Incident records are not included in this preview.");
  });

  it.each(["preview", "load_failed"] as const)("keeps %s incidents unknown in Inbox without a page-wide notice", async (reason) => {
    state.incidentResult = { status: "unavailable", reason, incidents: null };
    renderWithProviders(await InboxPage());
    expect(screen.getByTestId("inbox-signals").getAttribute("data-incident-count")).toBe("unavailable");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports a verified empty incident count as zero in Inbox", async () => {
    state.incidentResult = { status: "success", incidents: [] };
    renderWithProviders(await InboxPage());
    expect(screen.getByTestId("inbox-signals").getAttribute("data-incident-count")).toBe("0");
    expect(screen.queryByRole("status")).toBeNull();
  });

  describe.each([
    ["Monitoring", MonitoringPage],
    ["Administration", AdminPage],
  ] as const)("%s incident status", (_name, Page) => {
    it("shows a load failure without claiming that the list is empty", async () => {
      state.incidentResult = { status: "unavailable", reason: "load_failed", incidents: null };
      renderWithProviders(await Page());
      expect(screen.getByRole("status").textContent).toBe("Incident records could not be loaded. Refresh to try again.");
      expect(screen.queryByText(/No incidents recorded/i)).toBeNull();
    });

    it("shows a verified empty list without an unavailable notice", async () => {
      state.incidentResult = { status: "success", incidents: [] };
      renderWithProviders(await Page());
      expect(screen.getByText(/No incidents recorded/i)).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
