import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import {
  deploymentWorkspaceMap,
  isDeploymentVisible,
} from "@/lib/services/viewer-workspace";
import type { InitiativeDetail, TelemetrySeries } from "@/lib/data/dto";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { telemetryConnectorStatus, syntheticTraces } from "@/lib/telemetry/connector";
import { TelemetryConnectorCard } from "@/components/jeeves/telemetry-connector-card";
import { GpuQuotaCard } from "@/components/jeeves/gpu-quota-card";
import { CostBudgetCard, type PortfolioCostPoint } from "@/components/jeeves/cost-budget-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Portfolio-wide daily cost: sums each operating deployment's cost_tokens_usd_day
 * series by timestamp. Pure aggregation over data the page already loaded. */
function portfolioCostSeries(details: InitiativeDetail[]): PortfolioCostPoint[] {
  const totals = new Map<string, number>();
  for (const d of details) {
    const cost = d.telemetry.find((t) => t.kind === "cost_tokens_usd_day");
    if (!cost) continue;
    for (const p of cost.points) {
      totals.set(p.ts, (totals.get(p.ts) ?? 0) + p.value);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, totalUsd]) => ({ ts, totalUsd: Math.round(totalUsd * 100) / 100 }));
}

// Incidents carry no workspace column of their own — ownership resolves via
// deploymentId -> initiative.workspaceId (P0 read-isolation pass,
// external-review finding 2), same filtering GET /api/monitor/incidents
// applies over HTTP.
async function loadIncidents(viewerWorkspaceId: string | null): Promise<IncidentListRow[]> {
  const dbMode = process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (!dbMode) return [];
  try {
    const db = getDb();
    const [incidents, workspaceByDeployment] = await Promise.all([
      listIncidents(db),
      deploymentWorkspaceMap(db),
    ]);
    return incidents.filter((inc) =>
      isDeploymentVisible(workspaceByDeployment, inc.deploymentId, viewerWorkspaceId),
    );
  } catch {
    return [];
  }
}

function latest(series: TelemetrySeries | undefined): number | null {
  if (!series || series.points.length === 0) return null;
  return series.points[series.points.length - 1]!.value;
}

function breached(series: TelemetrySeries | undefined): boolean {
  if (!series || series.threshold === null) return false;
  return series.points.some((p) => p.value > series.threshold!);
}

export default async function MonitoringPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const initiatives = await provider.listInitiatives({ viewerWorkspaceId });
  const [details, incidents] = await Promise.all([
    Promise.all(initiatives.map((i) => provider.getInitiativeDetail(i.slug, { viewerWorkspaceId }))),
    loadIncidents(viewerWorkspaceId),
  ]);

  const operating = details
    .filter((d): d is InitiativeDetail => d !== null)
    .filter((d) => d.deployments.length > 0);

  const connectorStatus = telemetryConnectorStatus();
  // Traces keyed off the GPU initiative when present (a stable, meaningful
  // seed), else the first operating initiative, else a fixed fallback slug —
  // still fully deterministic (no Math.random/Date.now).
  const gpuInitiative = operating.find((d) =>
    d.telemetry.some((t) => t.kind === "gpu_util_pct"),
  );
  const traceSeedSlug = gpuInitiative?.summary.slug ?? operating[0]?.summary.slug ?? "monitoring";
  const traces = syntheticTraces(traceSeedSlug);
  const portfolioCost = portfolioCostSeries(operating);
  const gpuSeries = gpuInitiative?.telemetry.find((t) => t.kind === "gpu_util_pct");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="kicker text-primary">Monitoring</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Deployed models — operational health
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Eval quality, cost, and utilization across every deployment. Open an
          initiative to see full telemetry, or run the monitor from Administration.
        </p>
      </div>

      <TelemetryConnectorCard status={connectorStatus} traces={traces} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CostBudgetCard points={portfolioCost} />
        {gpuInitiative && gpuSeries ? (
          <GpuQuotaCard
            slug={gpuInitiative.summary.slug}
            title={gpuInitiative.summary.title}
            series={gpuSeries}
          />
        ) : (
          <Card data-slot="gpu-quota-card-missing">
            <CardHeader className="border-b bg-muted/40 py-3">
              <CardTitle className="kicker">GPU utilization vs quota</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No self-hosted initiative with GPU telemetry (claims-ocr-coder) is
                present in this data set.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-3">
          <CardTitle className="kicker">Deployments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SyntheticDataLabel className="p-4">
            <div className="scroll-thin overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="kicker">Initiative</TableHead>
                    <TableHead className="kicker">Version</TableHead>
                    <TableHead className="kicker">Status</TableHead>
                    <TableHead className="kicker text-right">Eval (hallucination)</TableHead>
                    <TableHead className="kicker text-right">Cost / day</TableHead>
                    <TableHead className="kicker text-right">GPU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operating.map((d) => {
                    const evalSeries = d.telemetry.find((t) => t.kind === "eval_hallucination");
                    const costSeries = d.telemetry.find((t) => t.kind === "cost_tokens_usd_day");
                    const gpuSeries = d.telemetry.find((t) => t.kind === "gpu_util_pct");
                    const evalVal = latest(evalSeries);
                    const isBreach = breached(evalSeries);
                    const dep = d.deployments[d.deployments.length - 1];
                    const costVal = latest(costSeries);
                    const gpuVal = latest(gpuSeries);
                    return (
                      <TableRow key={d.summary.slug}>
                        <TableCell>
                          <Link href={`/initiatives/${d.summary.slug}?tab=evals`} className="font-medium hover:text-primary hover:underline">
                            {d.summary.title}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">{d.summary.slug}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{dep?.version ?? "—"}</TableCell>
                        <TableCell><LifecycleBadge state={d.summary.state} /></TableCell>
                        <TableCell className="text-right">
                          {evalVal === null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              <span
                                className={`font-mono text-sm tabular-nums ${
                                  isBreach ? "font-medium text-status-critical-fg" : "text-foreground"
                                }`}
                              >
                                {evalVal.toFixed(3)}
                              </span>
                              {isBreach ? (
                                <span className="inline-flex items-center rounded-full bg-status-critical-bg px-1.5 py-0.5 text-[11px] font-medium text-status-critical-fg">
                                  over floor
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {costVal !== null ? `$${costVal.toFixed(0)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {gpuVal !== null ? `${gpuVal.toFixed(0)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </SyntheticDataLabel>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-3">
          <CardTitle className="kicker flex items-center gap-2">
            Incidents
            {incidents.length ? (
              <span className="stat-value text-xs text-foreground">{incidents.length}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
              <ShieldCheck className="size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No incidents recorded.</p>
              <p className="text-xs text-muted-foreground/70">
                Run the monitor from Administration to evaluate deployments
                against their eval-quality floor.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="kicker">Detected</TableHead>
                  <TableHead className="kicker">Deployment</TableHead>
                  <TableHead className="kicker">Control</TableHead>
                  <TableHead className="kicker">Reassessment</TableHead>
                  <TableHead className="kicker">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((inc) => (
                  <TableRow key={inc.id}>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{inc.detectedAt.slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-xs">{inc.deploymentId}</TableCell>
                    <TableCell className="font-mono text-xs">{inc.controlId}</TableCell>
                    <TableCell className="font-mono text-xs">{inc.reviewCycleId ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          inc.resolvedAt
                            ? "bg-status-good-bg text-status-good-fg"
                            : "bg-status-warning-bg text-status-warning-fg"
                        }`}
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                        {inc.resolvedAt ? "resolved" : "open"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
