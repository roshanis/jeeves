import { afterEach, describe, expect, it, vi } from "vitest";
import { availableCannedAuditQueryIds } from "./available-audit-queries";
import { isCannedAuditQueryAvailable } from "./canned-audit-queries";

afterEach(() => vi.unstubAllEnvs());

describe("canned audit queries by deployment mode", () => {
  it("offers all four in demo", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(availableCannedAuditQueryIds()).toHaveLength(4);
  });

  it("drops the fictional-approver query in production", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(availableCannedAuditQueryIds()).toEqual(["member-facing-phi", "overdue-controls", "q01-control-changes"]);
    expect(isCannedAuditQueryAvailable("approved-by-torres", "production")).toBe(false);
    expect(isCannedAuditQueryAvailable("approved-by-torres", "demo")).toBe(true);
  });
});
