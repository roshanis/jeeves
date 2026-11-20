import { deploymentMode } from "../config/deployment-mode";
import { ALL_CANNED_AUDIT_QUERY_IDS, isCannedAuditQueryAvailable } from "./canned-audit-queries";
import type { CannedAuditQueryId } from "./dto";

/** The canned queries this process offers and runs, by its own deployment mode. */
export function availableCannedAuditQueryIds(): CannedAuditQueryId[] {
  const mode = deploymentMode();
  return ALL_CANNED_AUDIT_QUERY_IDS.filter((id) => isCannedAuditQueryAvailable(id, mode));
}
