import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import { MockDataProvider } from "@/lib/data/mock-provider";
import type { InitiativeDetail } from "@/lib/data/dto";
import InboxPage from "@/app/(console)/inbox/page";
import AdminPage from "@/app/(console)/admin/page";
import MonitoringPage from "@/app/(console)/monitoring/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/jeeves/role-aware-inbox", () => ({
  RoleAwareInbox: ({ evalBreaches, incidentCount }: { evalBreaches: unknown[]; incidentCount: number | null }) => <div data-testid="inbox-signals" data-eval-count={evalBreaches.length} data-incident-count={incidentCount ?? "unavailable"} />,
}));

const state = vi.hoisted(() => ({ detail: null as InitiativeDetail | null }));
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
    expect(screen.getByText(/Incident data unavailable/i)).toBeTruthy();
  });

  it("keeps unavailable incident data explicit in Administration", async () => {
    renderWithProviders(await AdminPage());
    expect(screen.getByText(/Incident data unavailable/i)).toBeTruthy();
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
    expect(screen.getByText(/Incident data unavailable/i)).toBeTruthy();
  });
});
