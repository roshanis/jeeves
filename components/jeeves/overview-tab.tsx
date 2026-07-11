// Overview tab (ui-spec §3.1): "read this and understand the whole
// initiative in 20 seconds."
import type { InitiativeDetail } from "@/lib/data/dto";
import type { OverlayFlags } from "@/lib/domain/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "./tier-badge";
import { EvidenceLink } from "./evidence-link";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./reviews-tab";

/**
 * Human-readable explanation of which triage rule matched — mirrors
 * lib/triage/rules.ts#deriveTier exactly (first match wins). Display-only;
 * the authoritative derivation is always the imported rules module.
 */
function tierRuleExplanation(flags: OverlayFlags): string {
  if (flags.careCoverageInfluence && !flags.humanInLoop) {
    return "Rule 1: care-coverage ∧ ¬human-in-loop → Critical";
  }
  if (flags.careCoverageInfluence && flags.humanInLoop) {
    return "Rule 2: care-coverage ∧ human-in-loop → High";
  }
  if (flags.phi) {
    return "Rule 3: PHI → High";
  }
  if (flags.memberFacing && flags.individualImpact) {
    return "Rule 4: member-facing ∧ individual-impact → High";
  }
  if (flags.individualImpact) {
    return "Rule 5: individual-impact → Medium";
  }
  if (flags.memberFacing) {
    return "Rule 6: member-facing → Medium";
  }
  return "Rule 7: no overlay flags → Low";
}

export function OverviewTab({ detail }: { detail: InitiativeDetail }) {
  const { summary, reviews, deployments } = detail;
  const activeDeployment = deployments.find((d) => d.status === "deployed") ?? deployments[0];

  return (
    <div className="space-y-4" data-slot="overview-tab">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Requested by <span className="font-medium text-foreground">{summary.requester}</span>
            {summary.accountableApprover ? (
              <>
                {" "}· accountable approver{" "}
                <span className="font-medium text-foreground">{summary.accountableApprover}</span>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={summary.tier} />
            <span className="text-xs text-muted-foreground">
              {tierRuleExplanation(summary.flags)}
            </span>
          </div>
          {activeDeployment ? (
            <p className="text-sm text-muted-foreground">
              Current deployment:{" "}
              <Badge variant="secondary">
                {activeDeployment.version} ({activeDeployment.status})
              </Badge>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No deployment yet.</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <EvidenceLink slug={summary.slug} tab="reviews">Reviews</EvidenceLink>
            <EvidenceLink slug={summary.slug} tab="decisions">Decisions</EvidenceLink>
            <EvidenceLink slug={summary.slug} tab="controls">Controls</EvidenceLink>
            <EvidenceLink slug={summary.slug} tab="operate">Operate</EvidenceLink>
            <EvidenceLink slug={summary.slug} tab="audit">Audit trail</EvidenceLink>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Required domains — {summary.domainsSigned} of {summary.domainsRequired} signed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {reviews.map((review) => (
              <li key={review.domain} className="flex items-center justify-between gap-2 text-sm">
                <span>{DOMAIN_LABEL[review.domain]}</span>
                <ReviewStatusBadge status={review.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
