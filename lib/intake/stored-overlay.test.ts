// @vitest-environment node
import { describe, expect, it } from "vitest";
import { overlayFromStoredIntake } from "./stored-overlay";

describe("overlayFromStoredIntake", () => {
  const expected = {
    phi: true, memberFacing: false, careCoverageInfluence: true,
    vendorHosted: false, humanInLoop: true, individualImpact: false,
  };
  it("reads historical flat and current nested answers identically", () => {
    expect(overlayFromStoredIntake({
      "overlay.phi": true, "overlay.memberFacing": false,
      "overlay.careCoverageInfluence": true, "overlay.vendorHosted": false,
      "overlay.humanInLoop": true, "overlay.individualImpact": false,
    })).toEqual(expected);
    expect(overlayFromStoredIntake({ overlay: {
      touchesPHI: true, memberFacing: false, careCoverageInfluence: true,
      vendorHosted: false, humanInTheLoop: true, individualImpact: false,
    } })).toEqual(expected);
  });
  it("never treats unknown or string answers as an affirmative policy flag", () => {
    const none = Object.fromEntries(Object.keys(expected).map((key) => [key, false]));
    for (const stored of [null, {}, [], { overlay: null }, { overlay: { touchesPHI: "true" } }]) {
      expect(overlayFromStoredIntake(stored)).toEqual(none);
    }
  });
  it("uses the nested version exclusively rather than reviving stale flat values", () => {
    expect(overlayFromStoredIntake({ "overlay.phi": true, overlay: { touchesPHI: false } }).phi).toBe(false);
  });
});
