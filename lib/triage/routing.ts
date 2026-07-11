import type { Domain, OverlayFlags, Tier } from "../domain/types";

const LOW_BASE: readonly Domain[] = ["data-governance", "security"];

const MED_HIGH_BASE: readonly Domain[] = [
  "data-governance",
  "security",
  "tech-architecture",
  "responsible-ai",
  "legal",
];

const ALL_DOMAINS: readonly Domain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

function baseDomains(tier: Tier): readonly Domain[] {
  switch (tier) {
    case "low":
      return LOW_BASE;
    case "medium":
    case "high":
      return MED_HIGH_BASE;
    case "critical":
      return ALL_DOMAINS;
  }
}

/**
 * Required review domains = tier base ∪ flag-driven (seed-spec §2.1).
 *
 * Flag-driven additions apply at any tier:
 *   - PHI            -> + privacy-hipaa
 *   - vendor-hosted   -> + procurement, + legal
 *   - care-coverage   -> + clinical-safety
 */
export function requiredDomains(tier: Tier, flags: OverlayFlags): Set<Domain> {
  const domains = new Set<Domain>(baseDomains(tier));

  if (flags.phi) {
    domains.add("privacy-hipaa");
  }
  if (flags.vendorHosted) {
    domains.add("procurement");
    domains.add("legal");
  }
  if (flags.careCoverageInfluence) {
    domains.add("clinical-safety");
  }

  return domains;
}
