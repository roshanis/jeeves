// Client-safe: type-only import, because the console component uses it and
// lib/config/deployment-mode.ts pulls database code.
import type { DeploymentMode } from "../config/deployment-mode";
import type { CannedAuditQueryId } from "./dto";

/** Every canned audit query, in the order the console lists them. */
export const ALL_CANNED_AUDIT_QUERY_IDS: readonly CannedAuditQueryId[] = [
  "member-facing-phi",
  "approved-by-torres",
  "overdue-controls",
  "q01-control-changes",
];

/**
 * Queries that name a fictional demo persona. A production install has no such
 * person, so the query would always be empty and name someone who does not
 * exist; it is neither offered nor executable there.
 */
const DEMO_ONLY: ReadonlySet<CannedAuditQueryId> = new Set(["approved-by-torres"]);

export function isCannedAuditQueryAvailable(id: CannedAuditQueryId, mode: DeploymentMode): boolean {
  return mode === "demo" || !DEMO_ONLY.has(id);
}
