import { getAppProvider } from "@/app/_lib/data-provider";
import { OutcomeMetricsStrip } from "@/components/jeeves/outcome-metrics-strip";
import { PipelineBoard } from "@/components/jeeves/pipeline-board";
import { RiskHeatmap } from "@/components/jeeves/risk-heatmap";
import { SlaCallouts } from "@/components/jeeves/sla-callouts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const provider = getAppProvider();
  const [initiatives, metrics] = await Promise.all([
    provider.listInitiatives(),
    provider.outcomeMetrics(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Portfolio command center
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Every AI initiative, one governance view
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          All {initiatives.length} Meridian Health initiatives, their governance
          state, and portfolio outcome metrics at a glance. Approval is a
          checkpoint, not the end — deployed models stay under continuous review.
        </p>
      </div>

      <OutcomeMetricsStrip metrics={metrics} />

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40">
          <CardTitle>Pipeline board</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <PipelineBoard initiatives={initiatives} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle>Risk heatmap — tier × domain status</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <RiskHeatmap initiatives={initiatives} />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle>SLA / bottleneck callouts</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <SlaCallouts initiatives={initiatives} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
