import { getProvider } from "@/lib/data";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { AuditConsole } from "@/components/jeeves/audit-console";

export default async function AuditPage() {
  const provider = getProvider();
  const ids: CannedAuditQueryId[] = [
    "member-facing-phi",
    "approved-by-torres",
    "overdue-controls",
    "q01-control-changes",
  ];
  const entries = await Promise.all(
    ids.map(async (id) => [id, await provider.auditQuery(id)] as const),
  );
  const results = Object.fromEntries(entries) as Record<
    CannedAuditQueryId,
    AuditQueryRow[]
  >;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit query console</h1>
        <p className="text-sm text-muted-foreground">
          Every governance claim is backed by evidence-linked, queryable data.
          Audit is read-only for every role — no gated actions exist here.
        </p>
      </div>
      <AuditConsole results={results} />
    </div>
  );
}
