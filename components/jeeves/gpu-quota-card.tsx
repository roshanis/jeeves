"use client";

// GPU utilization vs quota card (M3 telemetry-depth) — surfaces the
// gpu_util_pct TelemetrySeries (only ever populated for the one self-hosted
// initiative, claims-ocr-coder — see lib/data/mock-provider.ts) against its
// 80% quota line (GPU_QUOTA_PCT in lib/data/db-provider.ts) on the
// Monitoring page. Chart style mirrors components/jeeves/operate-tab.tsx's
// SeriesPanel so Monitoring and the initiative detail page look consistent.
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TelemetrySeries } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";

function shortDate(ts: string): string {
  return ts.slice(5, 10);
}

export function GpuQuotaCard({
  slug,
  title,
  series,
}: {
  slug: string;
  title: string;
  series: TelemetrySeries;
}) {
  const data = series.points.map((p) => ({ ts: shortDate(p.ts), value: p.value }));
  const quota = series.threshold;
  const overQuota = quota !== null && series.points.some((p) => p.value > quota);

  return (
    <Card data-slot="gpu-quota-card" data-initiative-slug={slug}>
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          GPU utilization vs quota — {title}
          {overQuota ? (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
              Over quota
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SyntheticDataLabel>
          {quota !== null ? (
            <p className="text-xs text-muted-foreground">GPU quota: {quota}%</p>
          ) : null}
          <div className="h-56 w-full overflow-x-auto">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                <RechartsTooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-chart-3, #666)"
                  strokeWidth={2}
                  dot={false}
                />
                {quota !== null ? (
                  <ReferenceLine
                    y={quota}
                    stroke="#dc2626"
                    strokeDasharray="4 4"
                    label={{
                      value: `quota ${quota}%`,
                      fontSize: 11,
                      fill: "#dc2626",
                      position: "insideTopRight",
                    }}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SyntheticDataLabel>
      </CardContent>
    </Card>
  );
}
