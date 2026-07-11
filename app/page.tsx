import { getAppProvider } from "@/app/_lib/data-provider";
import { OutcomeMetricsStrip } from "@/components/jeeves/outcome-metrics-strip";
import { PipelineBoard } from "@/components/jeeves/pipeline-board";
import { RiskHeatmap } from "@/components/jeeves/risk-heatmap";
import { SlaCallouts } from "@/components/jeeves/sla-callouts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Home() {
  const provider = getAppProvider();
  const [initiatives, metrics] = await Promise.all([
    provider.listInitiatives(),
    provider.outcomeMetrics(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Portfolio command center
        </h1>
        <p className="text-sm text-muted-foreground">
          All 12 seeded initiatives, their governance state, and portfolio
          outcome metrics at a glance.
        </p>
      </div>

      <OutcomeMetricsStrip metrics={metrics} />

      <Card>
        <CardHeader>
          <CardTitle>Pipeline board</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineBoard initiatives={initiatives} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk heatmap — tier x domain status</CardTitle>
          </CardHeader>
          <CardContent>
            <RiskHeatmap initiatives={initiatives} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SLA / bottleneck callouts</CardTitle>
          </CardHeader>
          <CardContent>
            <SlaCallouts initiatives={initiatives} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
