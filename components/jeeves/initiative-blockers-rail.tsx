// Blockers / required-evidence right rail (case-file reshape): a compact,
// sticky sidebar next to an initiative's tabs that surfaces what is
// currently blocking progress and what evidence is still outstanding, so a
// reviewer/approver doesn't have to hunt across Reviews/Controls/Evals to
// find it. Server component — pure derivation from InitiativeDetail, no
// client state.
import type { ControlRow, InitiativeDetail } from "@/lib/data/dto";
import { AlertOctagon, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DOMAIN_LABEL } from "./domain-labels";

interface Blocker {
  label: string;
  severity: "high" | "amber";
}

// Fixed evidence-group display order — the 8 domain code prefixes (seed-spec
// §2.1 control ids), a stray/unmapped prefix (e.g. "Q" runtime controls)
// falls into a trailing "Other" group.
const DOMAIN_PREFIX_ORDER = ["L", "P", "T", "R", "S", "H", "C", "D"] as const;
const DOMAIN_PREFIX_LABEL: Record<(typeof DOMAIN_PREFIX_ORDER)[number], string> = {
  L: DOMAIN_LABEL.legal,
  P: DOMAIN_LABEL.procurement,
  T: DOMAIN_LABEL["tech-architecture"],
  R: DOMAIN_LABEL["responsible-ai"],
  S: DOMAIN_LABEL.security,
  H: DOMAIN_LABEL["privacy-hipaa"],
  C: DOMAIN_LABEL["clinical-safety"],
  D: DOMAIN_LABEL["data-governance"],
};

function deriveBlockers(detail: InitiativeDetail): Blocker[] {
  const blockers: Blocker[] = [];

  if (detail.summary.state === "paused" || detail.summary.state === "re_review") {
    blockers.push({ label: "Deployment paused — eval-quality breach", severity: "high" });
  }

  for (const review of detail.reviews) {
    if (review.status === "returned") {
      blockers.push({
        label: `Review returned: ${DOMAIN_LABEL[review.domain]}`,
        severity: "high",
      });
    } else if (review.status === "pending") {
      blockers.push({
        label: `Review pending: ${DOMAIN_LABEL[review.domain]}`,
        severity: "amber",
      });
    }
  }

  for (const control of detail.controls) {
    if (control.status === "breached" || control.status === "overdue") {
      blockers.push({ label: `Control ${control.id}: ${control.status}`, severity: "high" });
    } else if (control.status === "exception_requested") {
      blockers.push({ label: `Control ${control.id}: exception requested`, severity: "amber" });
    }
  }

  return blockers;
}

function outstandingEvidence(controls: ControlRow[]): ControlRow[] {
  return controls.filter(
    (c) => c.evidence === null && (c.status === "pending" || c.status === "overdue"),
  );
}

/** Group outstanding-evidence controls by their id's letter prefix (L-01 -> "L"). */
function groupEvidenceByPrefix(evidence: ControlRow[]): { prefix: string; label: string; items: ControlRow[] }[] {
  const byPrefix = new Map<string, ControlRow[]>();
  for (const item of evidence) {
    const prefix = item.id.split("-")[0] ?? "?";
    const bucket = byPrefix.get(prefix);
    if (bucket) {
      bucket.push(item);
    } else {
      byPrefix.set(prefix, [item]);
    }
  }

  const groups: { prefix: string; label: string; items: ControlRow[] }[] = [];
  for (const prefix of DOMAIN_PREFIX_ORDER) {
    const items = byPrefix.get(prefix);
    if (items) {
      groups.push({ prefix, label: DOMAIN_PREFIX_LABEL[prefix], items });
      byPrefix.delete(prefix);
    }
  }
  // Anything left over (e.g. "Q" runtime/quality controls) — keep it visible
  // rather than silently dropping it, in encounter order.
  for (const [prefix, items] of byPrefix) {
    groups.push({ prefix, label: "Other", items });
  }
  return groups;
}

const SEVERITY_META = {
  high: {
    icon: AlertOctagon,
    className: "bg-status-critical-bg text-status-critical-fg",
  },
  amber: {
    icon: AlertTriangle,
    className: "bg-status-serious-bg text-status-serious-fg",
  },
} as const;

export function InitiativeBlockersRail({ detail }: { detail: InitiativeDetail }) {
  const blockers = deriveBlockers(detail);
  const evidence = outstandingEvidence(detail.controls);
  const evidenceGroups = groupEvidenceByPrefix(evidence);

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" data-slot="blockers-rail">
      <Card className="overflow-hidden">
        <CardHeader className="border-b py-2.5">
          <CardTitle className="flex items-center gap-2">
            <span className="kicker">Blockers</span>
            {blockers.length > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {blockers.length}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open blockers — all required reviews signed and controls met.
            </p>
          ) : (
            <ul className="space-y-2">
              {blockers.map((b, i) => {
                const meta = SEVERITY_META[b.severity];
                const Icon = meta.icon;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                        meta.className,
                      )}
                    >
                      <Icon className="size-2.5" aria-hidden />
                    </span>
                    <span className="text-sm">{b.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-2.5">
          <CardTitle className="flex items-center gap-2">
            <span className="kicker">Required evidence</span>
            {evidence.length > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {evidence.length}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="scroll-thin max-h-80 space-y-3 overflow-y-auto pt-4">
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">All required evidence on file.</p>
          ) : (
            evidenceGroups.map((group) => (
              <div key={group.prefix} className="space-y-1.5">
                <p className="kicker">{group.label}</p>
                <ul className="space-y-1.5">
                  {group.items.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-2 text-sm">
                      <span className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {c.id}
                      </span>
                      <span className="text-muted-foreground">{c.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
