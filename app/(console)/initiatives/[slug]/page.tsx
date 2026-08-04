import { notFound } from "next/navigation";
import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TierBadge } from "@/components/jeeves/tier-badge";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { AccountableApproverChip } from "@/components/jeeves/accountable-approver-chip";
import { OverlayFlagChips } from "@/components/jeeves/overlay-flag-chips";
import { LiveActionsBar } from "@/components/jeeves/live-actions-bar";
import { OverviewTab } from "@/components/jeeves/overview-tab";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import { ReviewsTab } from "@/components/jeeves/reviews-tab";
import { DecisionsTab } from "@/components/jeeves/decisions-tab";
import { ControlsTab } from "@/components/jeeves/controls-tab";
import { EvalsTab } from "@/components/jeeves/operate-tab";
import { DeploymentsTab, DEPLOYMENT_STATUS_LABEL } from "@/components/jeeves/deployments-tab";
import { InitiativeBlockersRail } from "@/components/jeeves/initiative-blockers-rail";
import { AuditTab } from "@/components/jeeves/audit-tab";

const TAB_IDS = [
  "overview",
  "intake",
  "reviews",
  "decisions",
  "controls",
  "evals",
  "deployments",
  "audit",
] as const;
type TabId = (typeof TAB_IDS)[number];

function normalizeTab(tab: string | undefined): TabId {
  // Legacy deep links used "operate" before the tab split into
  // Evals/Deployments — route them to Evals rather than falling back to
  // Overview.
  if (tab === "operate") {
    return "evals";
  }
  return (TAB_IDS as readonly string[]).includes(tab ?? "")
    ? (tab as TabId)
    : "overview";
}

/** Segmented review-progress gauge — one filled tick per signed review, with
 * a mono "0/8 signed" readout so the instrument reads at a glance. */
function ReviewProgressBar({ signed, total }: { signed: number; total: number }) {
  if (total === 0) {
    return <span className="text-sm text-muted-foreground">No required domains</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex gap-0.5"
        role="img"
        aria-label={`${signed} of ${total} reviews signed`}
      >
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-1.5 rounded-[1px]",
              i < signed ? "bg-status-good" : "bg-status-neutral-bg",
            )}
          />
        ))}
      </div>
      <span className="stat-value text-xs text-foreground">
        {signed}/{total} signed
      </span>
    </div>
  );
}

export default async function InitiativeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ slug }, { tab }] = await Promise.all([params, searchParams]);
  const detail = await getInitiativeDetailCoherent(slug);
  if (!detail) {
    notFound();
  }
  const { summary } = detail;

  // At-a-glance case-file meta strip (persistent across tabs): review
  // sign-off progress, open-blocker count, and the latest deployment
  // version/status when one exists.
  const signedReviews = detail.reviews.filter((r) => r.status === "signed").length;
  const openBlockers =
    (summary.state === "paused" || summary.state === "re_review" ? 1 : 0) +
    detail.reviews.filter((r) => r.status === "returned" || r.status === "pending").length +
    detail.controls.filter(
      (c) =>
        c.status === "breached" ||
        c.status === "overdue" ||
        c.status === "exception_requested",
    ).length;
  const latestDeployment =
    detail.deployments.length > 0 ? detail.deployments[detail.deployments.length - 1] : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="panel card-quiet overflow-hidden" data-slot="case-file-header">
        <div className="p-5">
          {/* Line 1 — title + tier/lifecycle badges (the h1's immediate
              parent must contain the tier-badge: golden-path.spec.ts locates
              it via h1's parent element). */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{summary.title}</h1>
            <TierBadge tier={summary.tier} />
            <LifecycleBadge state={summary.state} />
          </div>

          {/* Line 2 — mono slug chip + overlay-flag chips. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {summary.slug}
            </span>
            <OverlayFlagChips flags={summary.flags} />
          </div>
        </div>

        {/* Line 3 — meta grid: requester, accountable approver, review
            progress, open blockers (+ latest deployment when present). Every
            label reads as a kicker; every value speaks the mono/tabular
            instrument voice. */}
        <div
          data-slot="record-meta"
          className={cn(
            "grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-5 py-4 sm:grid-cols-4",
            latestDeployment ? "lg:grid-cols-5" : undefined,
          )}
        >
          <div className="flex flex-col gap-1">
            <span className="kicker">Requested by</span>
            <span className="font-mono text-sm font-medium text-foreground">{summary.requester}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="kicker">Accountable approver</span>
            <AccountableApproverChip name={summary.accountableApprover} className="font-mono" />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="kicker">Reviews</span>
            <ReviewProgressBar signed={signedReviews} total={detail.reviews.length} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="kicker">Blockers</span>
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                openBlockers > 0
                  ? "bg-status-serious-bg text-status-serious-fg"
                  : "bg-status-good-bg text-status-good-fg",
              )}
            >
              {openBlockers > 0 ? (
                <AlertTriangle className="size-3" aria-hidden />
              ) : (
                <CheckCircle2 className="size-3" aria-hidden />
              )}
              <span className="stat-value">{openBlockers}</span> open blocker
              {openBlockers === 1 ? "" : "s"}
            </span>
          </div>

          {latestDeployment ? (
            <div className="flex flex-col gap-1">
              <span className="kicker">Latest deployment</span>
              <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                v{latestDeployment.version}{" "}
                <span className="font-sans font-normal text-muted-foreground">
                  · {DEPLOYMENT_STATUS_LABEL[latestDeployment.status]}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {summary.state === "paused" || summary.state === "re_review" ? (
        <div
          role="alert"
          data-slot="incident-banner"
          className="flex items-start gap-2.5 rounded-lg border border-status-critical-fg/25 bg-status-critical-bg px-4 py-3 text-sm text-status-critical-fg"
        >
          <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">Eval-quality breach.</strong>{" "}
            The Q-01 hallucination-rate floor was exceeded on a sustained window;
            this deployment is paused and a reassessment review cycle is open. See
            the Evals and Audit tabs for the incident record.
          </p>
        </div>
      ) : null}

      <LiveActionsBar slug={summary.slug} state={summary.state} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Tabs defaultValue={normalizeTab(tab)}>
          {/* Eight tabs do not fit one row below `lg`. They used to wrap into
              a fixed-height box and render ON TOP of the panel beneath
              (measured on an iPhone: "Evals / Deployments / Audit"
              overlapping the Summary heading). Wrapping cannot be rescued by
              letting the box grow either — TabsTrigger is
              `h-[calc(100%-1px)]`, so on a wrapped auto-height list every
              trigger stretches to the FULL list height and the two rows
              overlap each other.
              So: below `lg` this becomes a single scrollable row, the same
              pattern as the mobile nav strip (triggers stop flexing, the
              list is width-bounded, and the swipe is contained so it cannot
              trigger Safari's back gesture). At `lg` and up it is the
              original wrapping list, unchanged. */}
          <TabsList className="scroll-thin scroll-x-pane max-lg:w-full max-lg:flex-nowrap max-lg:justify-start max-lg:overflow-x-auto lg:flex-wrap max-lg:[&>*]:shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="intake">Intake</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="controls">Controls</TabsTrigger>
            <TabsTrigger value="evals">Evals</TabsTrigger>
            <TabsTrigger value="deployments">Deployments</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab detail={detail} />
          </TabsContent>
          <TabsContent value="intake">
            <IntakeTab intake={detail.intake} />
          </TabsContent>
          <TabsContent value="reviews">
            <ReviewsTab reviews={detail.reviews} slug={summary.slug} />
          </TabsContent>
          <TabsContent value="decisions">
            <DecisionsTab slug={summary.slug} decisions={detail.decisions} />
          </TabsContent>
          <TabsContent value="controls">
            <ControlsTab controls={detail.controls} />
          </TabsContent>
          <TabsContent value="evals">
            <EvalsTab slug={summary.slug} telemetry={detail.telemetry} />
          </TabsContent>
          <TabsContent value="deployments">
            <DeploymentsTab deployments={detail.deployments} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTab events={detail.events} />
          </TabsContent>
        </Tabs>

        <InitiativeBlockersRail detail={detail} />
      </div>
    </div>
  );
}
