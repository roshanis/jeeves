import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import ReviewsPage from "@/app/(console)/reviews/page";

const state = vi.hoisted(() => ({
  fail: false,
  calls: 0,
  workspace: null as string | null,
  askedFor: [] as (string | null)[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reviews",
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/notification-service", () => ({
  deliveryTransportStatus: () => ({ configured: false, channel: null, detail: "No transport." }),
  recentUndeliveredNotifications: async (_db: unknown, viewerWorkspaceId: string | null) => {
    state.calls += 1;
    state.askedFor.push(viewerWorkspaceId);
    if (state.fail) throw new Error("db down");
    return { rows: [], total: 0 };
  },
}));
vi.mock("@/app/_lib/portfolio-data", () => ({ loadPortfolioDetails: async () => [] }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => state.workspace,
  getAppProvider: () => ({}),
}));

beforeEach(() => {
  installResizeObserverStub();
  state.fail = false;
  state.calls = 0;
  state.workspace = null;
  state.askedFor = [];
  vi.stubEnv("DATA_PROVIDER", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Reviews page request queue", () => {
  it("loads the queue when only POSTGRES_URL is configured", async () => {
    vi.stubEnv("POSTGRES_URL", "postgres://example.invalid/db");
    renderWithProviders(await ReviewsPage());
    expect(state.calls).toBe(1);
  });

  // The queue names initiatives, so the page must ask for the viewer's own
  // workspace and never for everything.
  it("asks for the viewer's own workspace, and for the shared examples only when there is none", async () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    state.workspace = "ws_alpha";
    renderWithProviders(await ReviewsPage());
    state.workspace = null;
    renderWithProviders(await ReviewsPage());
    expect(state.askedFor).toEqual(["ws_alpha", null]);
  });

  it("says the requests could not be loaded when the query fails, not that none exist", async () => {
    vi.stubEnv("DATA_PROVIDER", "db");
    state.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(await ReviewsPage());
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByText(/No review requests recorded yet/i)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("does not query when no database is configured", async () => {
    renderWithProviders(await ReviewsPage());
    expect(state.calls).toBe(0);
  });
});
