import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import ControlsPage from "@/app/(console)/controls/page";

const state = vi.hoisted(() => ({ fail: false, calls: 0 }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/exception-service", () => ({
  listExceptions: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("db down");
    return [];
  },
}));
vi.mock("@/components/jeeves/control-catalog", () => ({ ControlCatalog: () => null }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => null,
  getAppProvider: () => ({ controlCatalog: async () => [] }),
}));

beforeEach(() => {
  installResizeObserverStub();
  state.fail = false;
  state.calls = 0;
  vi.stubEnv("DATA_PROVIDER", "db");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Controls page exceptions load", () => {
  it("says so and logs when the exceptions query fails, instead of claiming none exist", async () => {
    state.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(await ControlsPage());
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByText(/No control exceptions on file/i)).toBeNull();
    // Name and message only, under a request reference: a driver error quotes
    // bound parameters, so the raw error object must not reach the log.
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith("controls: could not load control exceptions", {
      requestId: expect.any(String),
      errorName: "Error",
      errorMessage: "db down",
    });
  });

  it("does not query without a database, and keeps the empty state", async () => {
    vi.stubEnv("DATA_PROVIDER", "");
    state.fail = true;
    renderWithProviders(await ControlsPage());
    expect(state.calls).toBe(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/No control exceptions on file/i)).not.toBeNull();
  });

  it("queries when only POSTGRES_URL is configured", async () => {
    vi.stubEnv("DATA_PROVIDER", "");
    vi.stubEnv("POSTGRES_URL", "postgres://example.invalid/db");
    renderWithProviders(await ControlsPage());
    expect(state.calls).toBe(1);
  });

  it("still shows the empty state when the query succeeds with no rows", async () => {
    renderWithProviders(await ControlsPage());
    expect(state.calls).toBe(1);
    expect(screen.getByText(/No control exceptions on file/i)).not.toBeNull();
  });
});
