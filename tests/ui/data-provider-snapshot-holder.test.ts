import { describe, expect, it, vi } from "vitest";

const getProvider = vi.fn((options?: { snapshotHolder?: () => object }) => ({ options }));
vi.mock("@/lib/data", () => ({ getProvider: (o?: { snapshotHolder?: () => object }) => getProvider(o) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

import { getAppProvider } from "@/app/_lib/data-provider";

describe("getAppProvider snapshot holder", () => {
  it("passes a holder that is request-scoped, so outside a render nothing is shared", () => {
    getAppProvider();
    getAppProvider();
    const holders = getProvider.mock.calls.map(([o]) => o?.snapshotHolder?.());
    expect(holders).toHaveLength(2);
    expect(holders[0]).toBeDefined();
    // Outside a React render, cache() is a passthrough: each call yields a fresh holder.
    expect(holders[0]).not.toBe(holders[1]);
  });
});
