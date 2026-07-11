import { notFound } from "next/navigation";
import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{summary.title}</h1>
          <TierBadge tier={summary.tier} />
          <LifecycleBadge state={summary.state} />
        </div>
        <p className="text-sm text-muted-foreground">{summary.slug}</p>
        <div className="flex flex-wrap items-center gap-4">
          <AccountableApproverChip name={summary.accountableApprover} />
          <OverlayFlagChips flags={summary.flags} />
        </div>
        <div
          data-slot="record-meta"
          className="flex flex-wrap items-center gap-4 text-xs tabular-nums text-muted-foreground"
        >
          <span>
            Reviews {signedReviews}/{detail.reviews.length} signed
          </span>
          <span>
            <span className={openBlockers > 0 ? "text-destructive" : undefined}>
              {openBlockers}
            </span>{" "}
            open blocker{openBlockers === 1 ? "" : "s"}
          </span>
          {latestDeployment ? (
            <span>
              v{latestDeployment.version} · {DEPLOYMENT_STATUS_LABEL[latestDeployment.status]}
            </span>
          ) : null}
        </div>
      </header>

      {summary.state === "paused" || summary.state === "re_review" ? (
        <div
          role="alert"
          data-slot="incident-banner"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <strong className="font-semibold">Eval-quality breach.</strong>{" "}
          The Q-01 hallucination-rate floor was exceeded on a sustained window;
          this deployment is paused and a reassessment review cycle is open. See
          the Evals and Audit tabs for the incident record.
        </div>
      ) : null}

      <LiveActionsBar slug={summary.slug} state={summary.state} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Tabs defaultValue={normalizeTab(tab)}>
          <TabsList className="flex-wrap">
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
