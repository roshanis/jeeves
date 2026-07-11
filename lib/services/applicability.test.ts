import { describe, expect, it } from "vitest";
import type { OverlayFlags } from "../domain/types";
import { applicabilityApplies } from "./applicability";

const NO_FLAGS: OverlayFlags = {
  phi: false,
  memberFacing: false,
  careCoverageInfluence: false,
  vendorHosted: false,
  humanInLoop: false,
  individualImpact: false,
};

describe("applicabilityApplies", () => {
  it("'all' always applies", () => {
    expect(applicabilityApplies("all", "low", NO_FLAGS)).toBe(true);
  });

  it("single atoms match their flag", () => {
    expect(applicabilityApplies("vendor=Y", "low", { ...NO_FLAGS, vendorHosted: true })).toBe(true);
    expect(applicabilityApplies("vendor=Y", "low", NO_FLAGS)).toBe(false);
    expect(applicabilityApplies("PHI=Y", "low", { ...NO_FLAGS, phi: true })).toBe(true);
    expect(applicabilityApplies("member-facing=Y", "low", { ...NO_FLAGS, memberFacing: true })).toBe(
      true,
    );
    expect(
      applicabilityApplies("care-coverage=Y", "low", { ...NO_FLAGS, careCoverageInfluence: true }),
    ).toBe(true);
  });

  it("tier>=X is inclusive and respects ordering", () => {
    expect(applicabilityApplies("tier>=medium", "medium", NO_FLAGS)).toBe(true);
    expect(applicabilityApplies("tier>=medium", "high", NO_FLAGS)).toBe(true);
    expect(applicabilityApplies("tier>=medium", "critical", NO_FLAGS)).toBe(true);
    expect(applicabilityApplies("tier>=medium", "low", NO_FLAGS)).toBe(false);
    expect(applicabilityApplies("tier>=high", "medium", NO_FLAGS)).toBe(false);
  });

  it("'A or B' matches when either atom is true", () => {
    const applicability = "member-facing=Y or care-coverage=Y";
    expect(applicabilityApplies(applicability, "low", { ...NO_FLAGS, memberFacing: true })).toBe(
      true,
    );
    expect(
      applicabilityApplies(applicability, "low", { ...NO_FLAGS, careCoverageInfluence: true }),
    ).toBe(true);
    expect(applicabilityApplies(applicability, "low", NO_FLAGS)).toBe(false);
  });

  it("'A and B' requires both atoms true", () => {
    const applicability = "PHI=Y and vendor=Y";
    expect(applicabilityApplies(applicability, "low", { ...NO_FLAGS, phi: true })).toBe(false);
    expect(applicabilityApplies(applicability, "low", { ...NO_FLAGS, vendorHosted: true })).toBe(
      false,
    );
    expect(
      applicabilityApplies(applicability, "low", { ...NO_FLAGS, phi: true, vendorHosted: true }),
    ).toBe(true);
  });

  it("throws on an unrecognized atom", () => {
    expect(() => applicabilityApplies("bogus=Z", "low", NO_FLAGS)).toThrow(/unrecognized atom/);
  });
});
