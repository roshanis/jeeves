import { describe, expect, it } from "vitest";
import { workspaceMismatch } from "./workspace-guard";

describe("lib/services/workspace-guard#workspaceMismatch", () => {
  it("a null-workspace (seeded/shared) resource is never a mismatch, regardless of session workspace", () => {
    expect(workspaceMismatch(null, null)).toBe(false);
    expect(workspaceMismatch(null, "ws-A")).toBe(false);
  });

  it("a workspace-tagged resource matches only the SAME session workspace", () => {
    expect(workspaceMismatch("ws-A", "ws-A")).toBe(false);
  });

  it("a workspace-tagged resource mismatches a different session workspace", () => {
    expect(workspaceMismatch("ws-A", "ws-B")).toBe(true);
  });

  it("a workspace-tagged resource mismatches a null session workspace (no wildcard for null sessions)", () => {
    expect(workspaceMismatch("ws-A", null)).toBe(true);
  });
});

// Public visitors may read examples, but can change only their own records.
describe("public demo writes", () => {
  it.each([
    [null, "visitor-a", true],
    ["visitor-b", "visitor-a", true],
    ["visitor-a", "visitor-a", false],
    ["visitor-a", null, true],
    [null, null, false],
  ] as const)("resource %s / session %s denies=%s", async (resource, session, denied) => {
    const guards = await import("./workspace-guard");
    expect(guards.mutationWorkspaceMismatch(resource, session)).toBe(denied);
  });
});
