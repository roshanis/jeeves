import { getAppProvider } from "@/app/_lib/data-provider";
import { OutcomeMetricsStrip } from "@/components/jeeves/outcome-metrics-strip";
import { RiskHeatmap } from "@/components/jeeves/risk-heatmap";
import { PortfolioView } from "@/components/jeeves/portfolio-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PortfolioPage() {
  const provider = getAppProvider();
  const [initiatives, metrics] = await Promise.all([
    provider.listInitiatives(),
    provider.outcomeMetrics(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Portfolio
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          All {initiatives.length} initiatives
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Meridian Health AI initiative, its risk tier, lifecycle state,
          review progress, and next action. Sort any column; filter with saved views.
        </p>
      </div>

      <OutcomeMetricsStrip metrics={metrics} />

      <PortfolioView initiatives={initiatives} />

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-3">
          <CardTitle className="text-sm">Risk heatmap — tier × domain status</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <RiskHeatmap initiatives={initiatives} />
        </CardContent>
      </Card>
    </div>
  );
}
