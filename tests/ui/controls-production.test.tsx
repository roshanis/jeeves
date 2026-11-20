/**
 * The control catalog's clock.
 *
 * The demo timeline is frozen (2026-07-01 plus the monitor's 14 days), so the
 * demo judges evidence freshness against that clock. A production install
 * holds real evidence dates: it must leave the clock to the browser, or every
 * control would be judged against July 2026 for ever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./helpers";
import ControlsPage from "@/app/(console)/controls/page";

const seen = vi.hoisted(() => ({ asOfMs: [] as Array<number | undefined> }));
vi.mock("@/components/jeeves/control-catalog", () => ({
  ControlCatalog: ({ asOfMs }: { asOfMs?: number }) => {
    seen.asOfMs.push(asOfMs);
    return null;
  },
}));
vi.mock("@/components/jeeves/exceptions-panel", () => ({ ExceptionsPanel: () => null }));
vi.mock("@/app/_lib/data-provider", () => ({
  getCurrentWorkspaceId: async () => "workspace-1",
  getAppProvider: () => ({ controlCatalog: async () => [] }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/services/exception-service", () => ({ listExceptions: async () => [] }));

afterEach(() => {
  vi.unstubAllEnvs();
  seen.asOfMs.length = 0;
});

describe("control catalog clock", () => {
  it("judges evidence against the frozen demo clock in demo", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    renderWithProviders(await ControlsPage());
    expect(seen.asOfMs).toEqual([Date.parse("2026-07-15T00:00:00Z")]);
  });

  it("leaves the clock to the browser in production", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    renderWithProviders(await ControlsPage(), { mode: "production" });
    expect(seen.asOfMs).toEqual([undefined]);
  });
});
