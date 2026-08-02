"use client";

// GPU utilization vs quota card (M3 telemetry-depth) — surfaces the
// gpu_util_pct TelemetrySeries (only ever populated for the one self-hosted
// initiative, claims-ocr-coder — see lib/data/mock-provider.ts) against its
// 80% quota line (GPU_QUOTA_PCT in lib/data/db-provider.ts) on the
// Monitoring page. Chart style mirrors components/jeeves/operate-tab.tsx's
// SeriesPanel so Monitoring and the initiative detail page look consistent.
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TelemetrySeries } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";

// Single-series chart -> categorical slot 1 (fixed data-color contract order).
const SERIES_COLOR = "var(--chart-1)";

function formatShortDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(5, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function GpuTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0]!;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
        <span className="text-muted-foreground">GPU utilization</span>
        <span className="ml-3 font-mono tabular-nums text-popover-foreground">
          {entry.value.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// Sparse series (<8 points) get a permanent marker at every point; dense
// series only get a marker + direct value label at the last point.
function makeEndLabelDot(dataLength: number, sparse: boolean) {
  return function EndLabelDot(props: {
    cx?: number;
    cy?: number;
    index?: number;
    payload?: { value: number };
  }) {
    const { cx, cy, index = -1, payload } = props;
    if (cx == null || cy == null) return <g key={`dot-${index}`} />;
    const isLast = index === dataLength - 1;
    const show = sparse || isLast;
    return (
      <g key={`dot-${index}`}>
        {show ? (
          <circle cx={cx} cy={cy} r={4} fill={SERIES_COLOR} stroke="var(--card)" strokeWidth={1.5} />
        ) : null}
        {isLast && payload ? (
          <text x={cx + 8} y={cy} dy={4} fontSize={11} fontWeight={500} fill="var(--foreground)">
            {payload.value.toFixed(0)}%
          </text>
        ) : null}
      </g>
    );
  };
}

// Threshold reference-line label rendered as an ink-on-chip badge — the
// label text always wears ink tokens, never the (critical) line color.
function ThresholdChip({
  viewBox,
  text,
}: {
  viewBox?: { x: number; y: number; width: number; height: number };
  text: string;
}) {
  if (!viewBox) return null;
  const width = text.length * 5.6 + 16;
  const x = viewBox.x + viewBox.width - width - 4;
  const y = viewBox.y - 16;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={width}
        height={16}
        rx={3}
        fill="var(--status-critical-bg)"
        stroke="var(--status-critical)"
        strokeOpacity={0.35}
      />
      <text x={width / 2} y={11} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--status-critical-fg)">
        {text}
      </text>
    </g>
  );
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
  const data = series.points.map((p) => ({ ts: formatShortDate(p.ts), value: p.value }));
  const quota = series.threshold;
  const overQuota = quota !== null && series.points.some((p) => p.value > quota);
  const sparse = data.length > 0 && data.length < 8;
  const tickInterval = data.length > 6 ? Math.ceil(data.length / 6) - 1 : 0;

  return (
    <Card data-slot="gpu-quota-card" data-initiative-slug={slug}>
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="kicker flex flex-wrap items-center gap-2">
          GPU utilization vs quota — {title}
          {overQuota ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-critical-bg px-2 py-0.5 text-xs font-medium text-status-critical-fg">
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              Over quota
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SyntheticDataLabel>
          {quota !== null ? (
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              GPU quota: {quota}%
            </p>
          ) : null}
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 18, right: 40, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="ts"
                  interval={tickInterval}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={{ stroke: "var(--chart-axis)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <RechartsTooltip
                  content={<GpuTooltip />}
                  cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "4 4" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  fill={SERIES_COLOR}
                  fillOpacity={0.12}
                  dot={makeEndLabelDot(data.length, sparse)}
                  activeDot={{ r: 5, fill: SERIES_COLOR, stroke: "var(--card)", strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
                {quota !== null ? (
                  <ReferenceLine
                    y={quota}
                    stroke="var(--status-critical)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    label={<ThresholdChip text={`quota ${quota}%`} />}
                  />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SyntheticDataLabel>
      </CardContent>
    </Card>
  );
}
