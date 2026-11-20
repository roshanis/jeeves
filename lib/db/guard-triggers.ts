// The append-only and installation guard triggers, in one place so the
// migration that arms them, the maintenance code that disables them and the
// boot check cannot drift apart. drizzle/0017 sets each to ENABLE ALWAYS.
//
// `ALTER TABLE t ENABLE TRIGGER USER` puts every trigger back to the default
// state 'O', which does not fire under session_replication_role = replica, so
// anything that disables the guards for a maintenance wipe must re-arm them
// with rearmGuardTriggers, not with ENABLE TRIGGER USER.
import { sql } from "drizzle-orm";

export const GUARD_TRIGGERS: readonly { table: string; trigger: string }[] = [
  { table: "audit_events", trigger: "audit_events_no_update" },
  { table: "audit_events", trigger: "audit_events_no_delete" },
  { table: "audit_events", trigger: "audit_events_no_truncate" },
  { table: "evidence_documents", trigger: "evidence_documents_immutable" },
  { table: "evidence_documents", trigger: "evidence_documents_no_truncate" },
  { table: "evidence_assessments", trigger: "evidence_assessments_immutable" },
  { table: "evidence_assessments", trigger: "evidence_assessments_no_truncate" },
  { table: "evidence_packets", trigger: "evidence_packets_immutable" },
  { table: "evidence_packets", trigger: "evidence_packets_no_truncate" },
  { table: "installation", trigger: "installation_no_rewrite" },
  { table: "installation", trigger: "installation_no_delete" },
  { table: "installation", trigger: "installation_no_truncate" },
];

/** Set the named guard triggers (every table's, by default) back to ENABLE ALWAYS. */
export async function rearmGuardTriggers(
  db: { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> },
  tables?: readonly string[],
): Promise<void> {
  for (const { table, trigger } of GUARD_TRIGGERS) {
    if (tables && !tables.includes(table)) continue;
    await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${trigger}`));
  }
}
