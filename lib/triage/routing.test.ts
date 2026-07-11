import { describe, expect, it } from "vitest";
import type { Domain, OverlayFlags } from "../domain/types";
import { requiredDomains } from "./routing";

function flags(overrides: Partial<OverlayFlags> = {}): OverlayFlags {
  return {
    phi: false,
    memberFacing: false,
    careCoverageInfluence: false,
    vendorHosted: false,
    humanInLoop: false,
    individualImpact: false,
    ...overrides,
  };
}

function domainSet(...domains: Domain[]): Set<Domain> {
  return new Set(domains);
}

describe("requiredDomains — base sets by tier", () => {
  it("Low + no flags -> exactly {data-governance, security}", () => {
    const result = requiredDomains("low", flags());
    expect(result).toEqual(domainSet("data-governance", "security"));
  });

  it("Medium + no flags -> exactly the 5-domain Medium/High base", () => {
    const result = requiredDomains("medium", flags());
    expect(result).toEqual(
      domainSet(
        "data-governance",
        "security",
        "tech-architecture",
        "responsible-ai",
        "legal",
      ),
    );
  });

  it("High + no flags -> exactly the 5-domain Medium/High base", () => {
    const result = requiredDomains("high", flags());
    expect(result).toEqual(
      domainSet(
        "data-governance",
        "security",
        "tech-architecture",
        "responsible-ai",
        "legal",
      ),
    );
  });

  it("Critical -> all 8 domains regardless of flags", () => {
    const result = requiredDomains("critical", flags());
    expect(result).toEqual(
      domainSet(
        "legal",
        "procurement",
        "tech-architecture",
        "responsible-ai",
        "security",
        "privacy-hipaa",
        "clinical-safety",
        "data-governance",
      ),
    );
    expect(result.size).toBe(8);
  });

  it("Critical + all flags on -> still exactly all 8 (no duplicates/overflow)", () => {
    const result = requiredDomains(
      "critical",
      flags({
        phi: true,
        memberFacing: true,
        careCoverageInfluence: true,
        vendorHosted: true,
        humanInLoop: true,
        individualImpact: true,
      }),
    );
    expect(result.size).toBe(8);
  });
});

describe("requiredDomains — seed-spec sanity fixture #7", () => {
  it("#7 provider-dedup-agent (Medium, no flags) requires exactly 5 domains", () => {
    const result = requiredDomains("medium", flags());
    expect(result.size).toBe(5);
  });
});

describe("requiredDomains — flag-driven additions apply at any tier", () => {
  it("PHI adds privacy-hipaa at Low tier", () => {
    const result = requiredDomains("low", flags({ phi: true }));
    expect(result.has("privacy-hipaa")).toBe(true);
    expect(result).toEqual(domainSet("data-governance", "security", "privacy-hipaa"));
  });

  it("PHI adds privacy-hipaa at Medium tier", () => {
    const result = requiredDomains("medium", flags({ phi: true }));
    expect(result.has("privacy-hipaa")).toBe(true);
  });

  it("PHI adds privacy-hipaa at High tier", () => {
    const result = requiredDomains("high", flags({ phi: true }));
    expect(result.has("privacy-hipaa")).toBe(true);
  });

  it("PHI at Critical is a no-op (already included) — still all 8", () => {
    const result = requiredDomains("critical", flags({ phi: true }));
    expect(result.size).toBe(8);
  });

  it("vendor-hosted adds procurement + legal at Low tier", () => {
    const result = requiredDomains("low", flags({ vendorHosted: true }));
    expect(result).toEqual(
      domainSet("data-governance", "security", "procurement", "legal"),
    );
  });

  it("vendor-hosted at Medium/High adds procurement (legal already in base)", () => {
    const result = requiredDomains("medium", flags({ vendorHosted: true }));
    expect(result).toEqual(
      domainSet(
        "data-governance",
        "security",
        "tech-architecture",
        "responsible-ai",
        "legal",
        "procurement",
      ),
    );
  });

  it("care-coverage adds clinical-safety at Low tier", () => {
    // Note: at Low tier, care-coverage-influence + human-in-loop combos are
    // theoretically inconsistent with deriveTier (which would push tier to
    // High/Critical), but requiredDomains is tested independently per its
    // own contract: any tier + careCoverageInfluence flag adds clinical-safety.
    const result = requiredDomains("low", flags({ careCoverageInfluence: true }));
    expect(result.has("clinical-safety")).toBe(true);
    expect(result).toEqual(
      domainSet("data-governance", "security", "clinical-safety"),
    );
  });

  it("care-coverage adds clinical-safety at High tier", () => {
    const result = requiredDomains(
      "high",
      flags({ careCoverageInfluence: true }),
    );
    expect(result.has("clinical-safety")).toBe(true);
  });

  it("care-coverage at Critical is a no-op (already included) — still all 8", () => {
    const result = requiredDomains(
      "critical",
      flags({ careCoverageInfluence: true }),
    );
    expect(result.size).toBe(8);
  });

  it("multiple flag-driven additions combine (PHI + vendor-hosted) at Low tier", () => {
    const result = requiredDomains(
      "low",
      flags({ phi: true, vendorHosted: true }),
    );
    expect(result).toEqual(
      domainSet(
        "data-governance",
        "security",
        "privacy-hipaa",
        "procurement",
        "legal",
      ),
    );
  });
});

describe("requiredDomains — returns a Set (not array)", () => {
  it("returns an actual Set instance", () => {
    const result = requiredDomains("low", flags());
    expect(result).toBeInstanceOf(Set);
  });
});
