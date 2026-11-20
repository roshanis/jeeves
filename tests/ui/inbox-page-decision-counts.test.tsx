import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./helpers";
import InboxPage from "@/app/(console)/inbox/page";

vi.mock("@/app/_lib/incident-data", () => ({
  loadIncidentsForViewer: async () => ({ status: "unavailable", reason: "preview", incidents: null }),
}));
vi.mock("@/components/jeeves/role-aware-inbox", () => ({
  RoleAwareInbox: (props: { decisionCounts: unknown; recentDecisions: unknown[] }) => {
    state.received = props;
    return <div />;
  },
}));

const state = vi.hoisted(() => ({
  received: null as { decisionCounts: unknown; recentDecisions: unknown[] } | null,
  details: [] as unknown[],
}));

vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => null,
  getAppProvider: () => ({
    controlCatalog: async () => [],
    listInitiatives: async () => [],
    listInitiativeDetails: async () => state.details,
  }),
}));

const detail = (slug: string, decisions: { type: string; at: string }[]) => ({
  summary: { slug, title: slug, tier: "low", state: "deployed", overdue: false },
  reviews: [],
  telemetry: [],
  decisions,
});

beforeEach(() => {
  vi.stubEnv("DATA_PROVIDER", "mock");
  state.received = null;
});

describe("Inbox page decision counts", () => {
  it("counts every decision in the portfolio, including ones older than the six-row feed", async () => {
    state.details = [
      detail("a", [
        { type: "approved", at: "2026-02-01T00:00:00Z" },
        { type: "approved", at: "2026-02-02T00:00:00Z" },
        { type: "fast_lane_approved", at: "2026-02-03T00:00:00Z" },
        { type: "conditionally_approved", at: "2026-02-04T00:00:00Z" },
      ]),
      detail("b", [
        { type: "approved", at: "2026-02-05T00:00:00Z" },
        { type: "conditionally_approved", at: "2026-02-06T00:00:00Z" },
        { type: "approved", at: "2026-02-07T00:00:00Z" },
        { type: "rejected", at: "2025-12-01T00:00:00Z" },
      ]),
    ];
    renderWithProviders(await InboxPage());
    expect(state.received!.recentDecisions).toHaveLength(6);
    expect(state.received!.decisionCounts).toEqual({ approved: 5, conditional: 2, rejected: 1, total: 8 });
  });
});
