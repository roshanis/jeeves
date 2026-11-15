import type { InitiativeDetail } from "@/lib/data/dto";
import { evaluateCompleteness } from "@/lib/intake/completeness";
import type { IntakePayload } from "@/lib/intake/types";

// No "use client": imported by both the client intake tab and the server-rendered blockers rail.
/**
 * Split intake.missing into gaps that block submitting, required-for-tier gaps (they do not block submit but
 * block passing QC) and advisory ones.
 * A stored shape that is not the nested live payload (older seeded examples) cannot be re-evaluated,
 * so every gap counts as blocking there.
 */
export function splitMissing(intake: NonNullable<InitiativeDetail["intake"]>): { blocking: string[]; requiredForTier: string[]; optional: string[] } {
  const fields = intake.fields as unknown as Record<string, unknown>;
  if (!fields.basics || typeof fields.basics !== "object") return { blocking: intake.missing, requiredForTier: [], optional: [] };
  try {
    const gaps = evaluateCompleteness(fields as unknown as IntakePayload).gaps;
    const blockingFields = new Set(gaps.filter((gap) => gap.level === "BLOCKING").map((gap) => gap.field));
    const tierFields = new Set(gaps.filter((gap) => gap.level === "REQUIRED_FOR_TIER").map((gap) => gap.field));
    return {
      blocking: intake.missing.filter((key) => blockingFields.has(key)),
      requiredForTier: intake.missing.filter((key) => !blockingFields.has(key) && tierFields.has(key)),
      optional: intake.missing.filter((key) => !blockingFields.has(key) && !tierFields.has(key)),
    };
  } catch {
    return { blocking: intake.missing, requiredForTier: [], optional: [] };
  }
}
