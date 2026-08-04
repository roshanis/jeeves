"use client";

// Evals tab (ui-spec §3.6, split from the former Operate tab — deployment
// version/status now lives on the separate Deployments tab): cost / eval /
// GPU telemetry panels from Observation series. EVERY panel is wrapped in
// SyntheticDataLabel ("Synthetic data — demo" + "Arize: not connected") — no
// exceptions, per plan §7 / Codex F6. GPU panel renders only when a
// gpu_util_pct series exists (only #6 claims-ocr-coder); it is absent
// entirely, not zeroed-out, elsewhere.
import { Activity } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TelemetrySeries } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SyntheticDataLabel } from "./synthetic-data-label";
import { DisableWithTooltip } from "./role-gate";

const KIND_TITLE: Record<TelemetrySeries["kind"], string> = {
  cost_tokens_usd_day: "Cost — daily token spend (USD)",
  eval_hallucination: "Eval — hallucination rate",
  eval_relevance: "Eval — relevance",
  gpu_util_pct: "GPU utilization (%)",
};

// Every panel in this tab is a single-series chart -> categorical slot 1
// (fixed data-color contract order; never cycled across panels).
const SERIES_COLOR = "var(--chart-1)";

// Deterministic offline-eval comparison for #5's v2.0 -> v2.1 promotion
// story (seed-spec §4: "v2.0->v2.1 offline eval comparison instead of live
// drift"). Fixed constants — this is a synthetic fixture, not telemetry.
const PROMOTION_EVAL_COMPARISON = [
  { metric: "Hallucination", "v2.0": 0.042, "v2.1": 0.031 },
  { metric: "Relevance", "v2.0": 0.87, "v2.1": 0.91 },
  { metric: "Completeness", "v2.0": 0.82, "v2.1": 0.88 },
];

function formatShortDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(5, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatValue(kind: TelemetrySeries["kind"], value: number): string {
  if (kind === "gpu_util_pct") return `${value.toFixed(0)}%`;
  if (kind === "cost_tokens_usd_day") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return value.toFixed(4);
}

function SeriesTooltip({
  active,
  payload,
  label,
  kind,
}: {
  active?: boolean;
  payload?: { value: number; color: string }[];
  label?: string;
  kind: TelemetrySeries["kind"];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0]!;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
        <span className="text-muted-foreground">{KIND_TITLE[kind]}</span>
        <span className="ml-3 font-mono tabular-nums text-popover-foreground">
          {formatValue(kind, entry.value)}
        </span>
      </div>
    </div>
  );
}

// Sparse series (<8 points) get a permanent marker at every point; dense
// series only get a marker + direct value label at the last point.
function makeEndLabelDot(dataLength: number, sparse: boolean, kind: TelemetrySeries["kind"]) {
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
            {formatValue(kind, payload.value)}
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

function SeriesPanel({ series }: { series: TelemetrySeries }) {
  const data = series.points.map((p) => ({ ts: formatShortDate(p.ts), value: p.value }));
  const sparse = data.length > 0 && data.length < 8;
  const tickInterval = data.length > 6 ? Math.ceil(data.length / 6) - 1 : 0;

  // Breach marker: an eval series with points strictly above its Q-01
  // threshold has crossed the floor. GPU quota (also a threshold) is a
  // utilization ceiling, not an eval breach, so it is excluded.
  const isEvalKind =
    series.kind === "eval_hallucination" || series.kind === "eval_relevance";
  const breached =
    isEvalKind &&
    series.threshold !== null &&
    series.points.some((p) => p.value > series.threshold!);

  return (
    <Card data-slot="telemetry-panel" data-kind={series.kind}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {KIND_TITLE[series.kind]}
          {breached ? (
            <span
              data-slot="breach-marker"
              className="inline-flex items-center gap-1.5 rounded-full bg-status-critical-bg px-2 py-0.5 text-xs font-medium text-status-critical-fg"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              Threshold exceeded
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SyntheticDataLabel>
          {series.threshold !== null ? (
            <p className="text-xs text-muted-foreground">
              {series.kind === "gpu_util_pct"
                ? `GPU quota: ${series.threshold}%`
                : `Q-01 threshold: ${series.threshold}`}
            </p>
          ) : null}
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 18, right: 44, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="ts"
                  interval={tickInterval}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={{ stroke: "var(--chart-axis)" }}
                />
                <YAxis
                  domain={
                    series.kind === "gpu_util_pct"
                      ? [0, 100]
                      : [(min: number) => Math.floor(min * 0.9 * 1000) / 1000, (max: number) => Math.ceil(max * 1.15 * 1000) / 1000]
                  }
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) => formatValue(series.kind, v)}
                />
                <RechartsTooltip
                  content={<SeriesTooltip kind={series.kind} />}
                  cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "4 4" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  fill={SERIES_COLOR}
                  fillOpacity={0.12}
                  dot={makeEndLabelDot(data.length, sparse, series.kind)}
                  activeDot={{ r: 5, fill: SERIES_COLOR, stroke: "var(--card)", strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
                {series.threshold !== null ? (
                  <ReferenceLine
                    y={series.threshold}
                    stroke="var(--status-critical)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    label={
                      <ThresholdChip
                        text={
                          series.kind === "gpu_util_pct"
                            ? `quota ${series.threshold}%`
                            : `threshold ${series.threshold}`
                        }
                      />
                    }
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

function PromotionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; color: string; name: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-3 font-mono tabular-nums text-popover-foreground">
              {p.value.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromotionComparisonPanel() {
  return (
    <Card data-slot="telemetry-panel" data-kind="promotion-comparison">
      <CardHeader>
        <CardTitle className="text-sm">Offline eval — v2.0 vs v2.1</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertTitle>Promotion gate: awaiting feedback-provenance sign-off</AlertTitle>
          <AlertDescription>
            v2.1 checkpoint cannot be promoted until feedback-provenance
            review is signed (RL/version-promotion story — not a training
            dashboard).
          </AlertDescription>
        </Alert>
        <SyntheticDataLabel>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={PROMOTION_EVAL_COMPARISON} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="metric"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={{ stroke: "var(--chart-axis)" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={false}
                  width={36}
                  domain={[0, (max: number) => Math.ceil(max * 1.15 * 10) / 10]}
                />
                <RechartsTooltip
                  content={<PromotionTooltip />}
                  cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
                <Bar dataKey="v2.0" name="v2.0" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="v2.1" name="v2.1" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SyntheticDataLabel>
      </CardContent>
    </Card>
  );
}

export function EvalsTab({
  slug,
  telemetry,
}: {
  slug: string;
  telemetry: TelemetrySeries[];
}) {
  const isPromotionStory = slug === "pa-correspondence-model";
  const evalSeries = telemetry.filter((s) => s.kind === "eval_hallucination" || s.kind === "eval_relevance");
  const costSeries = telemetry.filter((s) => s.kind === "cost_tokens_usd_day");
  const gpuSeries = telemetry.filter((s) => s.kind === "gpu_util_pct");

  return (
    <div className="space-y-4" data-slot="evals-tab">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Evals &amp; telemetry</h3>
        {/* Admin-shaped action, rendered disabled for every role in this
            read-only build (auth gating; see role-gate.tsx). */}
        <DisableWithTooltip label="Run monitor" variant="outline" />
      </div>

      {telemetry.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-center">
          <Activity className="size-5 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No telemetry for this initiative — it has no active deployment.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {isPromotionStory ? <PromotionComparisonPanel /> : null}
          {(isPromotionStory ? [] : evalSeries).map((s) => (
            <SeriesPanel key={s.kind} series={s} />
          ))}
          {costSeries.map((s) => (
            <SeriesPanel key={s.kind} series={s} />
          ))}
          {gpuSeries.map((s) => (
            <SeriesPanel key={s.kind} series={s} />
          ))}
        </div>
      )}
    </div>
  );
}
