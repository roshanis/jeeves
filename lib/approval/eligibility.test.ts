import { describe, expect, it } from "vitest";
import type { OverlayFlags, Tier } from "../domain/types";
import { fastLaneEligibility, type FastLanePolicy } from "./eligibility";

const policy: FastLanePolicy = {
  policyId: "FL-2026-01",
  accountableApprover: "Angela Torres",
};

function baseFlags(overrides: Partial<OverlayFlags> = {}): OverlayFlags {
  return {
    phi: false,
    memberFacing: false,
    careCoverageInfluence: false,
    vendorHosted: false,
    humanInLoop: true,
    individualImpact: false,
    ...overrides,
  };
}

function input(overrides: {
  tier?: Tier;
  intakeComplete?: boolean;
  flags?: Partial<OverlayFlags>;
} = {}) {
  return {
    tier: overrides.tier ?? ("low" as Tier),
    intakeComplete: overrides.intakeComplete ?? true,
    flags: baseFlags(overrides.flags),
    policy,
  };
}

describe("fastLaneEligibility — seed #2 marketing-ab-tester (eligible case)", () => {
  it("Low tier + intake complete + no PHI/member-facing/care-coverage -> eligible", () => {
    const result = fastLaneEligibility(input());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.policyId).toBe("FL-2026-01");
    expect(result.accountableApprover).toBe("Angela Torres");
  });
});

describe("fastLaneEligibility — single-criterion failures", () => {
  it("fails when tier is not low (e.g. medium)", () => {
    const result = fastLaneEligibility(input({ tier: "medium" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["tier is not low"]);
  });

  it("fails when tier is high", () => {
    const result = fastLaneEligibility(input({ tier: "high" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("tier is not low");
  });

  it("fails when tier is critical", () => {
    const result = fastLaneEligibility(input({ tier: "critical" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("tier is not low");
  });

  it("fails when intake is not complete", () => {
    const result = fastLaneEligibility(input({ intakeComplete: false }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["intake is not complete"]);
  });

  it("fails when PHI is true", () => {
    const result = fastLaneEligibility(input({ flags: { phi: true } }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["initiative touches PHI"]);
  });

  it("fails when member-facing is true", () => {
    const result = fastLaneEligibility(input({ flags: { memberFacing: true } }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["initiative is member-facing"]);
  });

  it("fails when care-coverage-influence is true", () => {
    const result = fastLaneEligibility(
      input({ flags: { careCoverageInfluence: true } }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "initiative influences care or coverage decisions",
    ]);
  });
});

describe("fastLaneEligibility — multiple simultaneous failures are all listed", () => {
  it("lists every failed criterion, in a stable order", () => {
    const result = fastLaneEligibility(
      input({
        tier: "critical",
        intakeComplete: false,
        flags: { phi: true, memberFacing: true, careCoverageInfluence: true },
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "tier is not low",
      "intake is not complete",
      "initiative touches PHI",
      "initiative is member-facing",
      "initiative influences care or coverage decisions",
    ]);
  });

  it("PHI + member-facing both fail together", () => {
    const result = fastLaneEligibility(
      input({ flags: { phi: true, memberFacing: true } }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "initiative touches PHI",
      "initiative is member-facing",
    ]);
  });
});

describe("fastLaneEligibility — policyId/accountableApprover always sourced from config, never hardcoded", () => {
  it("reflects whatever policy config is passed in, even when ineligible", () => {
    const customPolicy: FastLanePolicy = {
      policyId: "FL-9999-99",
      accountableApprover: "Someone Else",
    };
    const result = fastLaneEligibility({
      tier: "high",
      intakeComplete: true,
      flags: baseFlags(),
      policy: customPolicy,
    });
    expect(result.policyId).toBe("FL-9999-99");
    expect(result.accountableApprover).toBe("Someone Else");
    expect(result.eligible).toBe(false);
  });

  it("reflects custom policy config when eligible", () => {
    const customPolicy: FastLanePolicy = {
      policyId: "FL-CUSTOM",
      accountableApprover: "Custom Approver",
    };
    const result = fastLaneEligibility({
      tier: "low",
      intakeComplete: true,
      flags: baseFlags(),
      policy: customPolicy,
    });
    expect(result.eligible).toBe(true);
    expect(result.policyId).toBe("FL-CUSTOM");
    expect(result.accountableApprover).toBe("Custom Approver");
  });
});
