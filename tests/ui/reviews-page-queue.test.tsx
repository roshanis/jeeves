import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import ReviewsPage from "@/app/(console)/reviews/page";

const state = vi.hoisted(() => ({ fail: false, calls: 0 }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reviews",
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/notification-service", () => ({
  deliveryTransportStatus: () => ({ configured: false, channel: null, detail: "No transport." }),
  undeliveredNotifications: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("db down");
    return [];
  },
}));
vi.mock("@/app/_lib/portfolio-data", () => ({ loadPortfolioDetails: async () => [] }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => null,
  getAppProvider: () => ({}),
}));

beforeEach(() => {
  installResizeObserverStub();
  state.fail = false;
  state.calls = 0;
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

  it("does not query when no database is configured", async () => {
    renderWithProviders(await ReviewsPage());
    expect(state.calls).toBe(0);
  });
});
