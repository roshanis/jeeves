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
