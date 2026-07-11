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
import { OperateTab } from "@/components/jeeves/operate-tab";
import { AuditTab } from "@/components/jeeves/audit-tab";

const TAB_IDS = [
  "overview",
  "intake",
  "reviews",
  "decisions",
  "controls",
  "operate",
  "audit",
] as const;
type TabId = (typeof TAB_IDS)[number];

function normalizeTab(tab: string | undefined): TabId {
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
      </header>

      <LiveActionsBar slug={summary.slug} state={summary.state} />

      <Tabs defaultValue={normalizeTab(tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="operate">Operate</TabsTrigger>
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
        <TabsContent value="operate">
          <OperateTab
            slug={summary.slug}
            telemetry={detail.telemetry}
            deployments={detail.deployments}
          />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab events={detail.events} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
