import type { InitiativeDetail } from "@/lib/data/dto";
import { evaluateCompleteness } from "@/lib/intake/completeness";
import type { IntakePayload } from "@/lib/intake/types";

// No "use client": imported by both the client intake tab and the server-rendered blockers rail.
/**
 * Split intake.missing into gaps that block submitting and the rest (required-for-tier and advisory).
 * A stored shape that is not the nested live payload (older seeded examples) cannot be re-evaluated,
 * so every gap counts as blocking there.
 */
export function splitMissing(intake: NonNullable<InitiativeDetail["intake"]>): { blocking: string[]; optional: string[] } {
  const fields = intake.fields as unknown as Record<string, unknown>;
  if (!fields.basics || typeof fields.basics !== "object") return { blocking: intake.missing, optional: [] };
  try {
    const blockingFields = new Set(evaluateCompleteness(fields as unknown as IntakePayload).gaps.filter((gap) => gap.level === "BLOCKING").map((gap) => gap.field));
    return { blocking: intake.missing.filter((key) => blockingFields.has(key)), optional: intake.missing.filter((key) => !blockingFields.has(key)) };
  } catch {
    return { blocking: intake.missing, optional: [] };
  }
}
