import { describe, expect, it } from "vitest";
import { deriveTier } from "../triage/rules";
import type { OverlayFlags, Tier } from "../domain/types";
import { CHAMPION_PREFILL_PAYLOAD } from "./champion-prefill";
import { evaluateCompleteness } from "./completeness";
import type { IntakePayload } from "./types";

/** A payload that passes every BLOCKING, REQUIRED-FOR-TIER, and ADVISORY rule. */
function completePayload(): IntakePayload {
  return {
    basics: {
      title: "Formulary QA Bot",
      sponsorOrg: "Pharmacy Ops",
      requesterName: "Jordan Lee",
      requesterEmail: "jordan.lee@meridianhealth-demo.example",
      businessProblem:
        "Pharmacists manually cross-check formulary tiers against plan documents for every escalated call, which is slow and error-prone at current call volumes.",
    },
    useCase: {
      primaryUsers: "Pharmacy call-center agents",
      decisionInformed: "Formulary tier / coverage answer given to the caller",
      expectedVolume: "1k-10k/mo",
    },
    data: {
      dataSources: ["Formulary database (internal)", "Plan documents (internal)"],
      phiCategories: ["Demographics"],
      phiCategoriesOtherText: null,
      retentionIntent: "<=30 days",
      retentionIntentNote: null,
      trainingVsInference: "Inference-only",
    },
    modelVendor: {
      buildOrBuy: "Build (internal)",
      vendorName: null,
      hosting: "Self-hosted (Meridian infra)",
      modelType: "Rules engine",
    },
    populationImpact: {
      affectedPopulations: ["Members", "Pharmacy agents"],
      expectedBenefits: "Faster, more accurate formulary answers for callers.",
      expectedHarms: "Incorrect tier lookups could misinform a member about their coverage.",
    },
    deployment: {
      integrationPoints: ["Call-center agent desktop"],
      rolloutPlan: "Pilot with 5 agents for 2 weeks, then full call-center rollout.",
    },
    overlay: {
      touchesPHI: true,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: false,
      humanInTheLoop: true,
      individualImpact: false,
    },
    evidenceAttachments: [{ controlId: "H-01", fileName: "dpia.pdf", uploadedAt: "2026-07-01T00:00:00Z" }],
  };
}

/** Empty/blank payload — every optional field null/empty, nothing filled in. */
function emptyPayload(): IntakePayload {
  return {
    basics: {
      title: "",
      sponsorOrg: "",
      requesterName: "",
      requesterEmail: "",
      businessProblem: "",
    },
    useCase: {
      primaryUsers: "",
      decisionInformed: "",
      expectedVolume: null,
    },
    data: {
      dataSources: [],
      phiCategories: [],
      phiCategoriesOtherText: null,
      retentionIntent: null,
      retentionIntentNote: null,
      trainingVsInference: null,
    },
    modelVendor: {
      buildOrBuy: null,
      vendorName: null,
      hosting: null,
      modelType: null,
    },
    populationImpact: {
      affectedPopulations: [],
      expectedBenefits: null,
      expectedHarms: null,
    },
    deployment: {
      integrationPoints: [],
      rolloutPlan: null,
    },
    overlay: {
      touchesPHI: null,
      memberFacing: null,
      careCoverageInfluence: null,
      vendorHosted: null,
      humanInTheLoop: null,
      individualImpact: null,
    },
    evidenceAttachments: [],
  };
}

function overlayFlagsFromPayload(payload: IntakePayload): OverlayFlags {
  return {
    phi: !!payload.overlay.touchesPHI,
    memberFacing: !!payload.overlay.memberFacing,
    careCoverageInfluence: !!payload.overlay.careCoverageInfluence,
    vendorHosted: !!payload.overlay.vendorHosted,
    humanInLoop: !!payload.overlay.humanInTheLoop,
    individualImpact: !!payload.overlay.individualImpact,
  };
}

const ALL_BLK_IDS = [
  "BLK-01",
  "BLK-02",
  "BLK-03",
  "BLK-04",
  "BLK-05",
  "BLK-06",
  "BLK-07",
  "BLK-08",
  "BLK-09",
  "BLK-10",
  "BLK-11",
];

describe("evaluateCompleteness — empty payload", () => {
  it("produces all 11 BLK gaps and canSubmit=false", () => {
    const result = evaluateCompleteness(emptyPayload());
    expect(result.canSubmit).toBe(false);
    const blkIds = result.gaps.filter((g) => g.level === "BLOCKING").map((g) => g.ruleId).sort();
    expect(blkIds).toEqual([...ALL_BLK_IDS].sort());
  });

  it("every BLK gap carries level BLOCKING, a field, and a message", () => {
    const result = evaluateCompleteness(emptyPayload());
    for (const gap of result.gaps.filter((g) => g.level === "BLOCKING")) {
      expect(gap.level).toBe("BLOCKING");
      expect(typeof gap.field).toBe("string");
      expect(gap.field.length).toBeGreaterThan(0);
      expect(typeof gap.message).toBe("string");
      expect(gap.message.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateCompleteness — complete payload", () => {
  it("has no gaps at all and canSubmit=true", () => {
    const result = evaluateCompleteness(completePayload());
    expect(result.gaps).toEqual([]);
    expect(result.canSubmit).toBe(true);
    expect(result.completenessPct).toBe(100);
  });
});

describe("evaluateCompleteness — BLK rules each block submission when violated individually", () => {
  it("BLK-01 title empty -> blocks", () => {
    const payload = completePayload();
    payload.basics.title = "";
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-01")).toBe(true);
  });

  it("BLK-01 title too short (<3 chars) -> blocks", () => {
    const payload = completePayload();
    payload.basics.title = "ab";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-01")).toBe(true);
  });

  it("BLK-01 title too long (>120 chars) -> blocks", () => {
    const payload = completePayload();
    payload.basics.title = "a".repeat(121);
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-01")).toBe(true);
  });

  it("BLK-02 sponsorOrg empty -> blocks", () => {
    const payload = completePayload();
    payload.basics.sponsorOrg = "";
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-02")).toBe(true);
  });

  it("BLK-02 sponsorOrg too short (<2 chars) -> blocks", () => {
    const payload = completePayload();
    payload.basics.sponsorOrg = "a";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-02")).toBe(true);
  });

  it("BLK-03 requesterName empty -> blocks", () => {
    const payload = completePayload();
    payload.basics.requesterName = "";
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-03")).toBe(true);
  });

  it("BLK-03 requesterEmail malformed -> blocks", () => {
    const payload = completePayload();
    payload.basics.requesterEmail = "not-an-email";
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-03")).toBe(true);
  });

  it("BLK-04 businessProblem empty -> blocks", () => {
    const payload = completePayload();
    payload.basics.businessProblem = "";
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-04")).toBe(true);
  });

  it("BLK-04 businessProblem too short (<20 chars) -> blocks", () => {
    const payload = completePayload();
    payload.basics.businessProblem = "too short";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-04")).toBe(true);
  });

  it("BLK-05 overlay.touchesPHI null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = null;
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-05")).toBe(true);
  });

  it("BLK-06 overlay.memberFacing null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.memberFacing = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-06")).toBe(true);
  });

  it("BLK-07 overlay.careCoverageInfluence null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.careCoverageInfluence = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-07")).toBe(true);
  });

  it("BLK-08 overlay.vendorHosted null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-08")).toBe(true);
  });

  it("BLK-09 overlay.humanInTheLoop null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.humanInTheLoop = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-09")).toBe(true);
  });

  it("BLK-10 overlay.individualImpact null -> blocks", () => {
    const payload = completePayload();
    payload.overlay.individualImpact = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-10")).toBe(true);
  });

  it("overlay boolean false is a valid answer, not a gap (BLK-05..10 pass on false)", () => {
    const payload = completePayload();
    payload.overlay = {
      touchesPHI: false,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: false,
      humanInTheLoop: false,
      individualImpact: false,
    };
    // hosting must stay consistent with vendorHosted=false per RFT-05
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    payload.data.retentionIntent = null; // PHI is now false, RFT-01/02 shouldn't trigger
    const result = evaluateCompleteness(payload);
    const overlayBlkIds = ["BLK-05", "BLK-06", "BLK-07", "BLK-08", "BLK-09", "BLK-10"];
    for (const id of overlayBlkIds) {
      expect(result.gaps.some((g) => g.ruleId === id)).toBe(false);
    }
  });

  it("BLK-11 dataSources empty array -> blocks", () => {
    const payload = completePayload();
    payload.data.dataSources = [];
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "BLK-11")).toBe(true);
  });

  it("BLK-11 dataSources entry too short (<2 chars) -> blocks", () => {
    const payload = completePayload();
    payload.data.dataSources = ["x"];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "BLK-11")).toBe(true);
  });
});

describe("evaluateCompleteness — RFT rules fire only when trigger condition holds", () => {
  it("RFT-01 fires when touchesPHI=true and phiCategories is empty", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.phiCategories = [];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-01")).toBe(true);
  });

  it("RFT-01 does not fire when touchesPHI=false, even with empty phiCategories", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = false;
    payload.data.phiCategories = [];
    payload.data.retentionIntent = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-01")).toBe(false);
    expect(result.gaps.some((g) => g.ruleId === "RFT-02")).toBe(false);
  });

  it("RFT-02 fires when touchesPHI=true and retentionIntent is null", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-02")).toBe(true);
  });

  it("RFT-02 passes when touchesPHI=true and retentionIntent is set", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = "<=1 year";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-02")).toBe(false);
  });

  it("RFT-03 fires when vendorHosted=true and vendorName is missing", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = true;
    payload.modelVendor.hosting = "Vendor-hosted";
    payload.modelVendor.vendorName = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-03")).toBe(true);
  });

  it("RFT-03 fires when buildOrBuy=Buy and vendorHosted=false (vendor still required)", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = false;
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    payload.modelVendor.buildOrBuy = "Buy (vendor)";
    payload.modelVendor.vendorName = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-03")).toBe(true);
  });

  it("RFT-03 fires when buildOrBuy=Hybrid and vendorName missing", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = false;
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    payload.modelVendor.buildOrBuy = "Hybrid";
    payload.modelVendor.vendorName = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-03")).toBe(true);
  });

  it("RFT-03 does not fire when buildOrBuy=Build (internal) and vendorHosted=false", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = false;
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    payload.modelVendor.buildOrBuy = "Build (internal)";
    payload.modelVendor.vendorName = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-03")).toBe(false);
  });

  it("RFT-04 fires when vendorHosted=true and hosting != Vendor-hosted", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = true;
    payload.modelVendor.vendorName = "Acme AI";
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-04")).toBe(true);
  });

  it("RFT-04 does not fire when vendorHosted=false", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = false;
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-04")).toBe(false);
  });

  it("RFT-05 fires when vendorHosted=false and hosting != Self-hosted", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = false;
    payload.modelVendor.hosting = "Vendor-hosted";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-05")).toBe(true);
  });

  it("RFT-05 does not fire when vendorHosted=true", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = true;
    payload.modelVendor.vendorName = "Acme AI";
    payload.modelVendor.hosting = "Vendor-hosted";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-05")).toBe(false);
  });

  it("RFT-06 fires when careCoverageInfluence=true and decisionInformed is empty", () => {
    const payload = completePayload();
    payload.overlay.careCoverageInfluence = true;
    payload.useCase.decisionInformed = "";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-06")).toBe(true);
  });

  it("RFT-06 fires when careCoverageInfluence=true and decisionInformed is <10 chars", () => {
    const payload = completePayload();
    payload.overlay.careCoverageInfluence = true;
    payload.useCase.decisionInformed = "short";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-06")).toBe(true);
  });

  it("RFT-06 does not fire when careCoverageInfluence=false, even if decisionInformed is empty", () => {
    const payload = completePayload();
    payload.overlay.careCoverageInfluence = false;
    payload.useCase.decisionInformed = "";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-06")).toBe(false);
  });

  it("RFT-07 fires when tier is High and expectedHarms is empty", () => {
    const payload = completePayload();
    payload.populationImpact.expectedHarms = "";
    const tier: Tier = "high";
    const result = evaluateCompleteness(payload, tier);
    expect(result.gaps.some((g) => g.ruleId === "RFT-07")).toBe(true);
  });

  it("RFT-07 fires when tier is Critical and expectedHarms equals expectedBenefits", () => {
    const payload = completePayload();
    payload.populationImpact.expectedBenefits = "Same text here for both fields, long enough.";
    payload.populationImpact.expectedHarms = "Same text here for both fields, long enough.";
    const result = evaluateCompleteness(payload, "critical");
    expect(result.gaps.some((g) => g.ruleId === "RFT-07")).toBe(true);
  });

  it("RFT-07 does not fire when tier is Medium or Low, even with empty expectedHarms", () => {
    const payload = completePayload();
    payload.populationImpact.expectedHarms = "";
    expect(evaluateCompleteness(payload, "medium").gaps.some((g) => g.ruleId === "RFT-07")).toBe(false);
    expect(evaluateCompleteness(payload, "low").gaps.some((g) => g.ruleId === "RFT-07")).toBe(false);
  });

  it("RFT-07 does not fire when tier is undefined (no triage computed yet)", () => {
    const payload = completePayload();
    payload.populationImpact.expectedHarms = "";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-07")).toBe(false);
  });

  it("RFT-08 fires when trainingVsInference=Fine-tuning/training and all dataSources look session-only under PHI retention", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = "Session-only (no persistence)";
    payload.data.trainingVsInference = "Fine-tuning/training";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-08")).toBe(true);
  });

  it("RFT-08 fires when trainingVsInference=Both under session-only PHI retention", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = "Session-only (no persistence)";
    payload.data.trainingVsInference = "Both";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-08")).toBe(true);
  });

  it("RFT-08 does not fire when trainingVsInference=Inference-only", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = "Session-only (no persistence)";
    payload.data.trainingVsInference = "Inference-only";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-08")).toBe(false);
  });

  it("RFT-08 does not fire when retentionIntent is not session-only", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = true;
    payload.data.retentionIntent = "<=1 year";
    payload.data.trainingVsInference = "Fine-tuning/training";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "RFT-08")).toBe(false);
  });
});

describe("evaluateCompleteness — ADV rules never block submission", () => {
  it("ADV-01 fires when expectedVolume is null but canSubmit stays true (all BLK still pass)", () => {
    const payload = completePayload();
    payload.useCase.expectedVolume = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-01" && g.level === "ADVISORY")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("ADV-02 fires when affectedPopulations is empty, non-blocking", () => {
    const payload = completePayload();
    payload.populationImpact.affectedPopulations = [];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-02")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("ADV-03 fires when integrationPoints is empty, non-blocking", () => {
    const payload = completePayload();
    payload.deployment.integrationPoints = [];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-03")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("ADV-04 fires when rolloutPlan is <10 chars, non-blocking", () => {
    const payload = completePayload();
    payload.deployment.rolloutPlan = "short";
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-04")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("ADV-05 fires when evidence-eligible (vendorHosted=true) and evidenceAttachments is empty", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = true;
    payload.modelVendor.hosting = "Vendor-hosted";
    payload.modelVendor.vendorName = "Acme AI";
    payload.evidenceAttachments = [];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-05")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("ADV-05 does not fire when no evidence-eligible control applies (no PHI/vendor/care-coverage, low tier)", () => {
    const payload = completePayload();
    payload.overlay.touchesPHI = false;
    payload.overlay.vendorHosted = false;
    payload.overlay.careCoverageInfluence = false;
    payload.overlay.memberFacing = false;
    payload.modelVendor.hosting = "Self-hosted (Meridian infra)";
    payload.data.retentionIntent = null;
    payload.evidenceAttachments = [];
    const result = evaluateCompleteness(payload, "low");
    expect(result.gaps.some((g) => g.ruleId === "ADV-05")).toBe(false);
  });

  it("ADV-05 does not fire when evidence is attached", () => {
    const payload = completePayload();
    payload.overlay.vendorHosted = true;
    payload.modelVendor.hosting = "Vendor-hosted";
    payload.modelVendor.vendorName = "Acme AI";
    payload.evidenceAttachments = [{ controlId: "P-01", fileName: "vra.pdf", uploadedAt: "2026-07-01T00:00:00Z" }];
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-05")).toBe(false);
  });

  it("ADV-06 fires when modelType is null, non-blocking", () => {
    const payload = completePayload();
    payload.modelVendor.modelType = null;
    const result = evaluateCompleteness(payload);
    expect(result.gaps.some((g) => g.ruleId === "ADV-06")).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("no ADVISORY-level gap ever sets canSubmit to false on its own", () => {
    const payload = completePayload();
    payload.useCase.expectedVolume = null;
    payload.populationImpact.affectedPopulations = [];
    payload.deployment.integrationPoints = [];
    payload.deployment.rolloutPlan = "short";
    payload.modelVendor.modelType = null;
    const result = evaluateCompleteness(payload);
    expect(result.canSubmit).toBe(true);
    expect(result.gaps.filter((g) => g.level === "ADVISORY").length).toBeGreaterThan(0);
  });
});

describe("evaluateCompleteness — worked example (intake-spec §5), champion prefill", () => {
  it("BLOCKING: all pass, submission allowed", () => {
    const result = evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD);
    expect(result.gaps.filter((g) => g.level === "BLOCKING")).toEqual([]);
    expect(result.canSubmit).toBe(true);
  });

  it("triage computes tier=Critical for the champion flags (rule 1: care-coverage ∧ ¬human-in-loop)", () => {
    const tier = deriveTier(overlayFlagsFromPayload(CHAMPION_PREFILL_PAYLOAD));
    expect(tier).toBe("critical");
  });

  it("post-triage: exactly RFT-02 fails, all other applicable RFT rules pass", () => {
    const tier = deriveTier(overlayFlagsFromPayload(CHAMPION_PREFILL_PAYLOAD));
    const result = evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD, tier);
    const rftGaps = result.gaps.filter((g) => g.level === "REQUIRED_FOR_TIER").map((g) => g.ruleId);
    expect(rftGaps).toEqual(["RFT-02"]);
    // canSubmit reflects the initial submit gate (BLOCKING only) — the champion
    // case is submitted with a known RFT gap per intake-spec §2 Level 2 preamble.
    expect(result.canSubmit).toBe(true);
  });

  it("post-triage: ADV-05 fires (no evidence attached, vendor/PHI/care-coverage all evidence-eligible)", () => {
    const tier = deriveTier(overlayFlagsFromPayload(CHAMPION_PREFILL_PAYLOAD));
    const result = evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD, tier);
    const advGaps = result.gaps.filter((g) => g.level === "ADVISORY").map((g) => g.ruleId);
    expect(advGaps).toEqual(["ADV-05"]);
  });

  it("exactly two total gaps post-triage: RFT-02 and ADV-05", () => {
    const tier = deriveTier(overlayFlagsFromPayload(CHAMPION_PREFILL_PAYLOAD));
    const result = evaluateCompleteness(CHAMPION_PREFILL_PAYLOAD, tier);
    const ruleIds = result.gaps.map((g) => g.ruleId).sort();
    expect(ruleIds).toEqual(["ADV-05", "RFT-02"]);
  });
});

describe("evaluateCompleteness — gap shape", () => {
  it("each gap has ruleId, level, field, and message", () => {
    const result = evaluateCompleteness(emptyPayload());
    for (const gap of result.gaps) {
      expect(gap).toHaveProperty("ruleId");
      expect(gap).toHaveProperty("level");
      expect(gap).toHaveProperty("field");
      expect(gap).toHaveProperty("message");
      expect(["BLOCKING", "REQUIRED_FOR_TIER", "ADVISORY"]).toContain(gap.level);
    }
  });

  it("completenessPct is 100 for a fully complete payload and less than 100 when gaps exist", () => {
    expect(evaluateCompleteness(completePayload()).completenessPct).toBe(100);
    const partial = emptyPayload();
    expect(evaluateCompleteness(partial).completenessPct).toBeLessThan(100);
  });
});
