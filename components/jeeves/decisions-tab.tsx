// Decisions tab (ui-spec §3.4): final cross-domain decisions with approver,
// conditions linked to controls, policy citations for rejections, and a
// distinct fast-lane badge (named accountability, not autonomous approval).
import type { DecisionRow } from "@/lib/data/dto";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountableApproverChip } from "./accountable-approver-chip";
import { EvidenceLink } from "./evidence-link";

const DECISION_LABEL: Record<DecisionRow["type"], string> = {
  approved: "Approved",
  conditionally_approved: "Conditionally approved",
  rejected: "Rejected",
  fast_lane_approved: "Approved via Fast-Lane Policy FL-2026-01",
};

const DECISION_VARIANT: Record<DecisionRow["type"], "default" | "secondary" | "destructive"> = {
  approved: "default",
  conditionally_approved: "secondary",
  rejected: "destructive",
  fast_lane_approved: "secondary",
};

export function DecisionsTab({
  slug,
  decisions,
}: {
  slug: string;
  decisions: DecisionRow[];
}) {
  if (decisions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No decision recorded yet — this initiative has not completed review.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-slot="decisions-tab">
      {decisions.map((decision, i) => (
        <Card key={i}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Badge variant={DECISION_VARIANT[decision.type]}>
                {DECISION_LABEL[decision.type]}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">
                {decision.at.slice(0, 10)}
              </span>
            </CardTitle>
            <AccountableApproverChip name={decision.approver} />
          </CardHeader>
          <CardContent className="space-y-3">
            {decision.conditions.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Conditions
                </p>
                <ul className="space-y-1">
                  {decision.conditions.map((c) => (
                    <li key={c.controlId} className="flex items-baseline gap-2 text-sm">
                      <span>{c.text}</span>
                      <EvidenceLink slug={slug} tab="controls" className="text-xs">
                        → control {c.controlId}
                      </EvidenceLink>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {decision.citations.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Policy citations
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {decision.citations.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
