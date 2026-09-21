import type { OverlayFlags } from "../domain/types";

/** JSON object at the storage boundary, including legacy flat intake records. */
export type StoredIntakeFields = Record<string, unknown>;

/**
 * One mapping for current nested answers and historical flat answers.
 * Unknown is not affirmative. This preserves the boolean policy contract;
 * display-facing unknown states must not change deterministic triage rules.
 */
export function overlayFromStoredIntake(stored: unknown): OverlayFlags {
  const fields = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as StoredIntakeFields : {};
  const nested = fields.overlay && typeof fields.overlay === "object" && !Array.isArray(fields.overlay)
    ? fields.overlay as StoredIntakeFields : null;
  const answer = (current: string, legacy: string) =>
    (nested ? nested[current] : fields[`overlay.${legacy}`]) === true;
  return {
    phi: answer("touchesPHI", "phi"),
    memberFacing: answer("memberFacing", "memberFacing"),
    careCoverageInfluence: answer("careCoverageInfluence", "careCoverageInfluence"),
    vendorHosted: answer("vendorHosted", "vendorHosted"),
    humanInLoop: answer("humanInTheLoop", "humanInLoop"),
    individualImpact: answer("individualImpact", "individualImpact"),
  };
}
