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
import { cn } from "@/lib/utils";

function formatSyntheticDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

// Visual-only truncation (CSS ellipsis) — the element's text content stays
// the full trace id (accessibility + test contract), only the rendered
// glyphs are clipped by width. A true "split the string" middle-truncation
// would change the queryable text content, so this uses layout truncation
// (end-ellipsis) instead of literally splitting the id.
const TRUNCATED_MONO_ID = "block max-w-32 truncate font-mono text-xs sm:max-w-40";

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
        <CardTitle className="kicker flex flex-wrap items-center gap-2">
          Telemetry connector
          {status.configured ? (
            <span
              data-slot="connector-configured-indicator"
              className="inline-flex items-center gap-1.5 rounded-full bg-status-good-bg px-2 py-0.5 text-xs font-medium text-status-good-fg"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              configured
            </span>
          ) : (
            <span
              data-slot="connector-synthetic-indicator"
              className="inline-flex items-center gap-1.5 rounded-full bg-status-warning-bg px-2 py-0.5 text-xs font-medium text-status-warning-fg"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              synthetic
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Badge variant="secondary">Synthetic data — demo</Badge>

        {/* Compact definition row: provider / state / last-sync in one line,
            state carrying its own LED so the connector's live/synthetic
            reading is visible without parsing text. */}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
          <div className="flex items-baseline justify-between gap-2 sm:block">
            <dt className="kicker">Provider</dt>
            <dd className="font-mono font-medium text-foreground">{status.provider}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 sm:block">
            <dt className="kicker">State</dt>
            <dd className="inline-flex items-center gap-1.5 font-mono font-medium text-foreground">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  status.configured ? "bg-status-good" : "bg-status-warning",
                )}
                aria-hidden="true"
              />
              {status.configured ? "configured" : "not configured"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 sm:block">
            <dt className="kicker">Last sync</dt>
            <dd className="font-mono text-foreground">
              {status.lastSyncIso ? status.lastSyncIso.slice(0, 19).replace("T", " ") + " UTC" : "—"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{status.detail}</p>

        <div>
          <h4 className="kicker mb-2">Synthetic OTel traces — demo</h4>
          <div className="scroll-thin overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="kicker">Trace id</TableHead>
                  <TableHead className="kicker">Span</TableHead>
                  <TableHead className="kicker text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traces.map((t) => (
                  <TableRow key={t.traceId}>
                    <TableCell>
                      <span className={TRUNCATED_MONO_ID} title={t.traceId}>
                        {t.traceId}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{t.span}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
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
