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

  it("logs only a redacted name and message for a failed query", async () => {
    const err = Object.assign(new Error("Failed query: select ...\nparams: ws-marker-77"), {
      query: "select ...",
      params: ["ws-marker-77"],
      cause: Object.assign(new Error("x"), { code: "57014" }),
    });
    listInitiativeIndex.mockRejectedValue(err);
    const el = await ConsoleTopBar();
    expect(el.type).toBe(AppTopBar);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("ws-marker-77");
    expect(logged).not.toContain("params");
  });

  it("logs a single-line message of at most 300 characters for a long error", async () => {
    listInitiativeIndex.mockRejectedValue(new Error(`first line\n${"x".repeat(450)}`));
    await ConsoleTopBar();
    const call = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    const message = (call[1] as { errorMessage: string }).errorMessage;
    expect(message).not.toMatch(/[\r\n]/);
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it("passes the index through on success", async () => {
    listInitiativeIndex.mockResolvedValue([{ slug: "a", title: "A" }]);
    const el = await ConsoleTopBar();
    expect(el.props.initiatives).toEqual([{ slug: "a", title: "A" }]);
  });
});
