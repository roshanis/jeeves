import { beforeEach, describe, expect, it, vi } from "vitest";

const listInitiativeIndex = vi.fn();
let workspaceError: unknown = null;

vi.mock("@/app/_lib/data-provider", () => ({
  getAppProvider: () => ({ listInitiativeIndex }),
  getCurrentWorkspaceId: async () => {
    if (workspaceError) throw workspaceError;
    return null;
  },
}));
vi.mock("@/components/jeeves/app-topbar", () => ({ AppTopBar: () => null }));

import { redirect } from "next/navigation";
import { ConsoleTopBar } from "@/components/jeeves/console-top-bar";
import { AppTopBar } from "@/components/jeeves/app-topbar";

describe("ConsoleTopBar failure handling", () => {
  beforeEach(() => {
    listInitiativeIndex.mockReset();
    workspaceError = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the bar with an empty index when the database read fails", async () => {
    listInitiativeIndex.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const el = await ConsoleTopBar();
    expect(el.type).toBe(AppTopBar);
    expect(el.props.initiatives).toEqual([]);
  });

  it("renders the bar with an empty index when the viewer is unavailable", async () => {
    workspaceError = new Error("boot failed");
    const el = await ConsoleTopBar();
    expect(el.props.initiatives).toEqual([]);
  });

  it("rethrows Next redirect control-flow errors", async () => {
    listInitiativeIndex.mockImplementation(() => redirect("/sign-in"));
    await expect(ConsoleTopBar()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("passes the index through on success", async () => {
    listInitiativeIndex.mockResolvedValue([{ slug: "a", title: "A" }]);
    const el = await ConsoleTopBar();
    expect(el.props.initiatives).toEqual([{ slug: "a", title: "A" }]);
  });
});
