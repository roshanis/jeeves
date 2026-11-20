import { describe, expect, it } from "vitest";
import { CHAMPION_PREFILL_PAYLOAD } from "./champion-prefill";
import { evaluateCompleteness } from "./completeness";
import { LEGACY_SELF_HOSTED, SELF_HOSTED, withCurrentHosting } from "./hosting";
import { intakePayloadSchema } from "./schema";
import type { IntakePayload } from "./types";

function selfHosted(hosting: string): IntakePayload {
  return {
    ...CHAMPION_PREFILL_PAYLOAD,
    overlay: { ...CHAMPION_PREFILL_PAYLOAD.overlay, vendorHosted: false },
    modelVendor: { ...CHAMPION_PREFILL_PAYLOAD.modelVendor, hosting: hosting as never },
  };
}

describe("self-hosted hosting value", () => {
  it("is stored as a neutral 'Self-hosted'", () => {
    expect(SELF_HOSTED).toBe("Self-hosted");
    expect(intakePayloadSchema.safeParse(selfHosted(SELF_HOSTED)).success).toBe(true);
    expect(intakePayloadSchema.safeParse(selfHosted(LEGACY_SELF_HOSTED)).success).toBe(false);
  });

  it("reads a legacy stored value as the new one without touching other values or the input", () => {
    const legacy = selfHosted(LEGACY_SELF_HOSTED);
    expect(withCurrentHosting(legacy).modelVendor.hosting).toBe(SELF_HOSTED);
    expect(legacy.modelVendor.hosting).toBe(LEGACY_SELF_HOSTED);
    expect(withCurrentHosting(selfHosted("Vendor-hosted")).modelVendor.hosting).toBe("Vendor-hosted");
    expect(withCurrentHosting({ "overlay.phi": true } as never)).toEqual({ "overlay.phi": true });
    expect(withCurrentHosting(null as never)).toBeNull();
  });

  it("scores a legacy stored value like the new one (RFT-05)", () => {
    const ruleIds = (p: IntakePayload) => evaluateCompleteness(p).gaps.map((g) => g.ruleId);
    expect(ruleIds(selfHosted(SELF_HOSTED))).not.toContain("RFT-05");
    expect(ruleIds(selfHosted(LEGACY_SELF_HOSTED))).not.toContain("RFT-05");
    const gap = evaluateCompleteness(selfHosted("Vendor-hosted"), "critical").gaps.find((g) => g.ruleId === "RFT-05");
    expect(gap?.message).toBe("Hosting must be set to Self-hosted when overlay.vendorHosted is false.");
  });
});
