// Control catalog page body (plan §6 / ui-spec §9 house style): a
// governance-credible read of the full ControlDefinition catalog, grouped by
// domain (8 domains) plus a "Runtime" group for the one live-enforced
// control, Q-01 (seed-spec §3). Read-only — no mutation buttons anywhere,
// matching every other catalog/audit surface in the app.
import type { Domain } from "@/lib/domain/types";
import type { ControlRow } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DOMAIN_LABEL } from "./reviews-tab";
import { ControlStatusChip } from "./controls-tab";

// Domain order per seed-spec §3 (Legal ... Data Governance), Runtime last —
// Runtime isn't one of the 8 governance domains, it's the one control with
// live enforcement teeth (Q-01), so it gets its own trailing group.
const DOMAIN_ORDER: (Domain | "runtime")[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
  "runtime",
];

const GROUP_LABEL: Record<Domain | "runtime", string> = {
  ...DOMAIN_LABEL,
  runtime: "Runtime",
};

function ControlRowCard({ control }: { control: ControlRow }) {
  return (
    <div
      data-slot="control-catalog-row"
      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {control.id}
          </span>
          <span className="font-medium">{control.name}</span>
          <ControlStatusChip status={control.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {/* Applicability line: ControlRow has no applicability field yet —
              policy source + threshold (when present) is the closest signal
              the DTO currently carries. */}
          Policy source: {control.policySource ?? "—"}
          {control.threshold !== null ? ` · Threshold: ${control.threshold}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 text-xs text-muted-foreground sm:items-end">
        <span className="max-w-64 truncate sm:text-right">
          {control.evidence ?? "No evidence on file"}
        </span>
      </div>
    </div>
  );
}

export function ControlCatalog({ controls }: { controls: ControlRow[] }) {
  const byDomain = new Map<Domain | "runtime", ControlRow[]>();
  for (const group of DOMAIN_ORDER) byDomain.set(group, []);
  for (const control of controls) {
    if (!byDomain.has(control.domain)) byDomain.set(control.domain, []);
    byDomain.get(control.domain)!.push(control);
  }

  return (
    <div data-slot="control-catalog" className="flex flex-col gap-6">
      {DOMAIN_ORDER.map((group) => {
        const rows = byDomain.get(group) ?? [];
        if (rows.length === 0) return null;
        return (
          <Card key={group} data-slot="control-catalog-group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {GROUP_LABEL[group]}
                <Badge variant="secondary">{rows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {rows.map((control) => (
                <ControlRowCard key={control.id} control={control} />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// M4: extend ControlRow with cadence/owner/enforcementMode/exceptionProcess
