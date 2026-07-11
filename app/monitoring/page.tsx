import Link from "next/link";
import { getAppProvider } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import type { InitiativeDetail, TelemetrySeries } from "@/lib/data/dto";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
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

async function loadIncidents(): Promise<IncidentListRow[]> {
  const dbMode = process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (!dbMode) return [];
  try {
    return await listIncidents(getDb());
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
  const initiatives = await provider.listInitiatives();
  const [details, incidents] = await Promise.all([
    Promise.all(initiatives.map((i) => provider.getInitiativeDetail(i.slug))),
    loadIncidents(),
  ]);

  const operating = details
    .filter((d): d is InitiativeDetail => d !== null)
    .filter((d) => d.deployments.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Monitoring
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Deployed models — operational health
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Eval quality, cost, and utilization across every deployment. Open an
          initiative to see full telemetry, or run the monitor from Administration.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-3">
          <CardTitle className="text-sm">Deployments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SyntheticDataLabel>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Initiative</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Eval (hallucination)</TableHead>
                  <TableHead>Cost / day</TableHead>
                  <TableHead>GPU</TableHead>
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
                  return (
                    <TableRow key={d.summary.slug}>
                      <TableCell>
                        <Link href={`/initiatives/${d.summary.slug}?tab=evals`} className="font-medium hover:text-primary hover:underline">
                          {d.summary.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">{d.summary.slug}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{dep?.version ?? "—"}</TableCell>
                      <TableCell><LifecycleBadge state={d.summary.state} /></TableCell>
                      <TableCell>
                        {evalVal === null ? (
                          <span className="text-xs text-muted-foreground">no eval series</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 text-sm tabular-nums ${
                              isBreach ? "font-medium text-destructive" : "text-foreground"
                            }`}
                          >
                            {evalVal.toFixed(3)}
                            {isBreach ? (
                              <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                                over floor
                              </span>
                            ) : null}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {latest(costSeries) !== null ? `$${latest(costSeries)!.toFixed(0)}` : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {latest(gpuSeries) !== null ? `${latest(gpuSeries)!.toFixed(0)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SyntheticDataLabel>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-3">
          <CardTitle className="text-sm">
            Incidents{incidents.length ? ` (${incidents.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {incidents.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No incidents recorded. Run the monitor from Administration to
              evaluate deployments against their eval-quality floor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected</TableHead>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Control</TableHead>
                  <TableHead>Reassessment</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((inc) => (
                  <TableRow key={inc.id}>
                    <TableCell className="text-xs text-muted-foreground">{inc.detectedAt.slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-xs">{inc.deploymentId}</TableCell>
                    <TableCell>{inc.controlId}</TableCell>
                    <TableCell className="font-mono text-xs">{inc.reviewCycleId ?? "—"}</TableCell>
                    <TableCell className="text-xs">{inc.resolvedAt ? "resolved" : "open"}</TableCell>
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
