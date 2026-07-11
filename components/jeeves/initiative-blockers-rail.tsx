// Blockers / required-evidence right rail (case-file reshape): a compact,
// sticky sidebar next to an initiative's tabs that surfaces what is
// currently blocking progress and what evidence is still outstanding, so a
// reviewer/approver doesn't have to hunt across Reviews/Controls/Evals to
// find it. Server component — pure derivation from InitiativeDetail, no
// client state.
import type { ControlRow, InitiativeDetail } from "@/lib/data/dto";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOMAIN_LABEL } from "./domain-labels";

interface Blocker {
  label: string;
  severity: "high" | "amber";
}

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

export function InitiativeBlockersRail({ detail }: { detail: InitiativeDetail }) {
  const blockers = deriveBlockers(detail);
  const evidence = outstandingEvidence(detail.controls);

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" data-slot="blockers-rail">
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-2.5">
          <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            Blockers
            {blockers.length > 0 ? (
              <Badge variant="secondary">{blockers.length}</Badge>
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
              {blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      b.severity === "high" ? "bg-destructive" : "bg-amber-500"
                    }`}
                  />
                  <span className="text-sm">{b.label}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-2.5">
          <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            Required evidence
            {evidence.length > 0 ? (
              <Badge variant="secondary">{evidence.length}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">All required evidence on file.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((c) => (
                <li key={c.id} className="text-sm text-muted-foreground">
                  <span className="font-mono">{c.id}</span> {c.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
