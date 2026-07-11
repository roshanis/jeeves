import { describe, expect, it } from "vitest";
import type { OverlayFlags } from "../domain/types";
import { deriveTier } from "./rules";

/** Helper to build OverlayFlags tersely from the seed-spec's Y/N column order:
 * PHI / member-facing / care-coverage / vendor-hosted / human-in-loop / individual-impact
 */
function flags(
  phi: boolean,
  memberFacing: boolean,
  careCoverageInfluence: boolean,
  vendorHosted: boolean,
  humanInLoop: boolean,
  individualImpact: boolean,
): OverlayFlags {
  return {
    phi,
    memberFacing,
    careCoverageInfluence,
    vendorHosted,
    humanInLoop,
    individualImpact,
  };
}

describe("deriveTier — seed-spec §2 golden fixtures (12 initiatives)", () => {
  // # | slug | flags Y/Y/Y/Y/N/Y etc | expected tier
  it("#1 prior-auth-summarizer Y/Y/Y/Y/N/Y -> Critical", () => {
    expect(deriveTier(flags(true, true, true, true, false, true))).toBe("critical");
  });

  it("#2 marketing-ab-tester N/N/N/Y/Y/N -> Low", () => {
    expect(deriveTier(flags(false, false, false, true, true, false))).toBe("low");
  });

  it("#3 social-sentiment-miner Y/Y/N/Y/Y/N -> High", () => {
    expect(deriveTier(flags(true, true, false, true, true, false))).toBe("high");
  });

  it("#4 member-chat-copilot Y/Y/N/N/Y/N -> High", () => {
    expect(deriveTier(flags(true, true, false, false, true, false))).toBe("high");
  });

  it("#5 pa-correspondence-model Y/N/Y/N/N/Y -> Critical", () => {
    expect(deriveTier(flags(true, false, true, false, false, true))).toBe("critical");
  });

  it("#6 claims-ocr-coder Y/N/Y/N/Y/Y -> High", () => {
    expect(deriveTier(flags(true, false, true, false, true, true))).toBe("high");
  });

  it("#7 provider-dedup-agent N/N/N/N/Y/Y -> Medium", () => {
    expect(deriveTier(flags(false, false, false, false, true, true))).toBe("medium");
  });

  it("#8 nurse-triage-summarizer Y/N/Y/N/N/Y -> Critical", () => {
    expect(deriveTier(flags(true, false, true, false, false, true))).toBe("critical");
  });

  it("#9 formulary-qa-bot Y/Y/N/Y/N/N -> High", () => {
    expect(deriveTier(flags(true, true, false, true, false, false))).toBe("high");
  });

  it("#10 fwa-anomaly-detector Y/N/Y/N/Y/Y -> High", () => {
    expect(deriveTier(flags(true, false, true, false, true, true))).toBe("high");
  });

  it("#11 hr-resume-screener N/N/N/Y/Y/Y -> Medium", () => {
    expect(deriveTier(flags(false, false, false, true, true, true))).toBe("medium");
  });

  it("#12 callcenter-qa-scorer N/N/N/N/Y/Y -> Medium", () => {
    expect(deriveTier(flags(false, false, false, false, true, true))).toBe("medium");
  });
});

describe("deriveTier — rule-by-rule edge combinations (first match wins)", () => {
  // Rule 1: care-coverage ∧ ¬human-in-loop -> Critical (highest priority)
  it("rule 1: care-coverage + no human-in-loop -> Critical, even with no other flags", () => {
    expect(
      deriveTier(flags(false, false, true, false, false, false)),
    ).toBe("critical");
  });

  it("rule 1 beats rule 3 (PHI): care-coverage+no-human-in-loop+PHI -> Critical not High", () => {
    expect(deriveTier(flags(true, false, true, false, false, false))).toBe(
      "critical",
    );
  });

  // Rule 2: care-coverage ∧ human-in-loop -> High
  it("rule 2: care-coverage + human-in-loop -> High, even with no other flags", () => {
    expect(deriveTier(flags(false, false, true, false, true, false))).toBe(
      "high",
    );
  });

  // Rule 3: PHI -> High (regardless of other lower-priority flags)
  it("rule 3: PHI alone -> High", () => {
    expect(deriveTier(flags(true, false, false, false, false, false))).toBe(
      "high",
    );
  });

  it("rule 3 beats rule 5/6: PHI + individual-impact + member-facing -> still High (rule 3/4 territory) ", () => {
    expect(deriveTier(flags(true, true, false, false, false, true))).toBe(
      "high",
    );
  });

  // Rule 4: member-facing ∧ individual-impact -> High
  it("rule 4: member-facing + individual-impact (no PHI, no care-coverage) -> High", () => {
    expect(deriveTier(flags(false, true, false, false, false, true))).toBe(
      "high",
    );
  });

  // Rule 5: individual-impact alone -> Medium
  it("rule 5: individual-impact alone -> Medium", () => {
    expect(deriveTier(flags(false, false, false, false, false, true))).toBe(
      "medium",
    );
  });

  // Rule 6: member-facing alone -> Medium
  it("rule 6: member-facing alone (no individual-impact) -> Medium", () => {
    expect(deriveTier(flags(false, true, false, false, false, false))).toBe(
      "medium",
    );
  });

  // Rule 7: otherwise -> Low
  it("rule 7: no flags at all -> Low", () => {
    expect(deriveTier(flags(false, false, false, false, false, false))).toBe(
      "low",
    );
  });

  it("rule 7: vendor-hosted + human-in-loop only -> Low", () => {
    expect(deriveTier(flags(false, false, false, true, true, false))).toBe(
      "low",
    );
  });
});
