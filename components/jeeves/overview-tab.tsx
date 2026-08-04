// Overview tab (ui-spec §3.1): "read this and understand the whole
// initiative in 20 seconds."
import type { InitiativeDetail, ReviewRow } from "@/lib/data/dto";
import type { OverlayFlags } from "@/lib/domain/types";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Gavel,
  History,
  ShieldCheck,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TierBadge } from "./tier-badge";
import { EvidenceLink } from "./evidence-link";
import { DOMAIN_LABEL } from "./domain-labels";

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

// Domain-status cell styling (goal #3): neutral/medium/good/serious per the
// reserved status family + the blue tier-medium slot for "in progress".
// Kept local to this file rather than exported from domain-labels.tsx —
// that module is shared with other tabs and its ReviewStatusBadge already
// covers the pill treatment used elsewhere.
const DOMAIN_STATUS_META: Record<
  ReviewRow["status"],
  { label: string; icon: LucideIcon; className: string }
> = {
  pending: {
    label: "Not started",
    icon: Circle,
    className: "bg-status-neutral-bg text-status-neutral-fg",
  },
  drafted: {
    label: "Drafted",
    icon: Clock,
    className: "bg-tier-medium-bg text-tier-medium-fg",
  },
  signed: {
    label: "Signed",
    icon: CheckCircle2,
    className: "bg-status-good-bg text-status-good-fg",
  },
  returned: {
    label: "Returned",
    icon: AlertTriangle,
    className: "bg-status-serious-bg text-status-serious-fg",
  },
};

const QUICK_LINKS: { tab: "reviews" | "decisions" | "controls" | "operate" | "audit"; label: string; icon: LucideIcon }[] = [
  { tab: "reviews", label: "Reviews", icon: ClipboardList },
  { tab: "decisions", label: "Decisions", icon: Gavel },
  { tab: "controls", label: "Controls", icon: ShieldCheck },
  { tab: "operate", label: "Operate", icon: Activity },
  { tab: "audit", label: "Audit trail", icon: History },
];

export function OverviewTab({ detail }: { detail: InitiativeDetail }) {
  const { summary, reviews, deployments } = detail;
  const activeDeployment = deployments.find((d) => d.status === "deployed") ?? deployments[0];

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]"
      data-slot="overview-tab"
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="kicker">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Requested by <span className="font-medium text-foreground">{summary.requester}</span>
              {summary.accountableApprover ? (
                <>
                  {" "}· accountable approver{" "}
                  <span className="font-medium text-foreground">{summary.accountableApprover}</span>
                </>
              ) : null}
            </p>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2">
              <TierBadge tier={summary.tier} />
              <code className="font-mono text-[11px] text-muted-foreground">
                {tierRuleExplanation(summary.flags)}
              </code>
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
          </CardContent>
        </Card>

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="kicker">Required domains</span>
            <span className="stat-value text-xs text-foreground">
              {summary.domainsSigned}/{summary.domainsRequired} signed
            </span>
          </div>
          {/* Status matrix: 2-column grid of cells, hairline-separated
              rather than floating boxes — the grid reads as one instrument
              surface. sm:grid-cols-2 pairs cells into rows, so each cell
              gets its own right + bottom hairline except along the matrix's
              own trailing edges (last column / last row). */}
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {reviews.map((review, i) => {
              const meta = DOMAIN_STATUS_META[review.status];
              const Icon = meta.icon;
              const isLastItem = i === reviews.length - 1;
              const isLastRow = i >= reviews.length - (reviews.length % 2 === 0 ? 2 : 1);
              const isLastCol = i % 2 === 1 || i === reviews.length - 1;
              return (
                <div
                  key={review.domain}
                  data-slot="domain-status-cell"
                  data-domain={review.domain}
                  data-status={review.status}
                  className={cn(
                    "flex items-center justify-between gap-2 border-border px-4 py-2.5 text-sm",
                    !isLastItem && "border-b",
                    !isLastRow ? "sm:border-b" : "sm:border-b-0",
                    !isLastCol && "sm:border-r",
                  )}
                >
                  <span className="font-medium">{DOMAIN_LABEL[review.domain]}</span>
                  <span
                    className={cn(
                      "inline-flex h-5 w-fit items-center gap-1 rounded-full px-2 text-xs font-medium",
                      meta.className,
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Card className="h-fit overflow-hidden">
        <CardHeader className="border-b py-2.5">
          <CardTitle className="kicker">Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y p-0">
          {QUICK_LINKS.map(({ tab, label, icon }) => (
            <EvidenceLink key={tab} slug={summary.slug} tab={tab} variant="nav" icon={icon}>
              {label}
            </EvidenceLink>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
