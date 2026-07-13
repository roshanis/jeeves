// Telemetry connector status card (M3 telemetry-depth) — the honesty
// pattern for observability, mirroring lib/agents/registry.ts's
// agentRuntimeStatus() card treatment. Server-rendered: telemetryConnectorStatus()
// is a pure function of env vars, and lastSyncIso (when configured) is a
// fixed synthetic timestamp, not Date.now() — no client clock needed here,
// so there is no hydration-mismatch risk.
import type { SyntheticTraceRow, TelemetryConnectorStatus } from "@/lib/telemetry/connector";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatSyntheticDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

export function TelemetryConnectorCard({
  status,
  traces,
}: {
  status: TelemetryConnectorStatus;
  traces: SyntheticTraceRow[];
}) {
  return (
    <Card data-slot="telemetry-connector-card">
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Telemetry connector
          {status.configured ? (
            <span
              data-slot="connector-configured-indicator"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              &#10003; configured
            </span>
          ) : (
            <span
              data-slot="connector-synthetic-indicator"
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              &#9679; synthetic
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge variant="secondary">Synthetic data — demo</Badge>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="font-medium">{status.provider}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">State</dt>
            <dd className="font-medium">{status.configured ? "configured" : "not configured"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last sync</dt>
            <dd className="font-mono text-xs">
              {status.lastSyncIso ? status.lastSyncIso.slice(0, 19).replace("T", " ") + " UTC" : "—"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{status.detail}</p>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Synthetic OTel traces — demo
            </h4>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trace id</TableHead>
                  <TableHead>Span</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traces.map((t) => (
                  <TableRow key={t.traceId}>
                    <TableCell className="font-mono text-xs">{t.traceId}</TableCell>
                    <TableCell className="text-xs">{t.span}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {formatSyntheticDuration(t.durationMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
