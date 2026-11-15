import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, installResizeObserverStub } from "./helpers";
import ControlsPage from "@/app/(console)/controls/page";

const state = vi.hoisted(() => ({ fail: false }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/exception-service", () => ({
  listExceptions: async () => {
    if (state.fail) throw new Error("db down");
    return [];
  },
}));
vi.mock("@/components/jeeves/control-catalog", () => ({ ControlCatalog: () => null }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => null,
  getAppProvider: () => ({ controlCatalog: async () => [] }),
}));

beforeEach(() => installResizeObserverStub());
afterEach(() => vi.restoreAllMocks());

describe("Controls page exceptions load", () => {
  it("says so and logs when the exceptions query fails, instead of claiming none exist", async () => {
    state.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(await ControlsPage());
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByText(/No control exceptions on file/i)).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it("still shows the empty state when the query succeeds with no rows", async () => {
    state.fail = false;
    renderWithProviders(await ControlsPage());
    expect(screen.getByText(/No control exceptions on file/i)).not.toBeNull();
  });
});
