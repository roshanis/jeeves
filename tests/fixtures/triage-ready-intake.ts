import { CHAMPION_PREFILL_PAYLOAD } from "../../lib/intake/champion-prefill";
import type { IntakePayload } from "../../lib/intake/types";

/**
 * The champion prefill with its one deliberate gap answered. QC refuses to
 * pass an intake that still has a REQUIRED_FOR_TIER gap open (decision d01),
 * so every test that triages the champion successfully starts from this.
 */
export const TRIAGE_READY_CHAMPION_PAYLOAD: IntakePayload = {
  ...CHAMPION_PREFILL_PAYLOAD,
  data: { ...CHAMPION_PREFILL_PAYLOAD.data, retentionIntent: "<=30 days" },
};
