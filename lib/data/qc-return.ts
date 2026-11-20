import type { AuditEventRow } from "./dto";

const RETURN_PREFIX = "Returned from QC to the requester: ";

/** The latest QC return recorded for an initiative (initiative-service.returnFromQc writes the reason only to the audit event). */
export function latestQcReturn(events: readonly AuditEventRow[] | undefined): { actor: string; reason: string } | undefined {
  const event = (events ?? [])
    .filter((e) => e.action === "return_to_requester")
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (!event) return undefined;
  return { actor: event.actor, reason: event.detail.startsWith(RETURN_PREFIX) ? event.detail.slice(RETURN_PREFIX.length) : event.detail };
}
