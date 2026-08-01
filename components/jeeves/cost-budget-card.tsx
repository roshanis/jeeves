"use client";

// Cost + token-budget telemetry panel (M3 telemetry-depth) — portfolio cost
// view built from the cost_tokens_usd_day TelemetrySeries every initiative
// already carries, plus a static daily token-budget reference line.
//
// The real per-day token usage lives in the run_budget table (lib/db/schema.ts),
// which this UI-only task must not read directly (lib/services/route-guard.ts,
// which enforces DAILY_TOKEN_CAP = 500_000, is a server-only module and must
// not be imported into a client/page bundle). So this card renders the cost
// series the provider already exposes, clearly labeled, and hardcodes the
// 500,000 cap as a static synthetic reference (see DAILY_TOKEN_CAP in
// lib/services/route-guard.ts — kept in sync by convention, not by import).
import { LineChart as EmptySeriesIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";

// Static synthetic reference — mirrors DAILY_TOKEN_CAP in
// lib/services/route-guard.ts. Do not import that server module here.
const DAILY_TOKEN_BUDGET_REFERENCE = 500_000;

// Single-series chart -> categorical slot 1 (fixed data-color contract order).
const SERIES_COLOR = "var(--chart-1)";
const SERIES_NAME = "Portfolio cost/day (USD)";

function formatShortDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(5, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function CostTooltip({
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
        <span className="text-muted-foreground">{SERIES_NAME}</span>
        <span className="ml-3 font-mono tabular-nums text-popover-foreground">
          {formatUsd(entry.value)}
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
    payload?: { totalUsd: number };
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
            {formatUsd(payload.totalUsd)}
          </text>
        ) : null}
      </g>
    );
  };
}

export interface PortfolioCostPoint {
  ts: string;
  totalUsd: number;
}

export function CostBudgetCard({ points }: { points: PortfolioCostPoint[] }) {
  const data = points.map((p) => ({ ts: formatShortDate(p.ts), totalUsd: p.totalUsd }));
  const sparse = data.length > 0 && data.length < 8;
  const tickInterval = data.length > 6 ? Math.ceil(data.length / 6) - 1 : 0;

  return (
    <Card data-slot="cost-budget-card">
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="text-sm">Cost &amp; daily token budget</CardTitle>
      </CardHeader>
      <CardContent>
        <SyntheticDataLabel>
          <p className="text-xs text-muted-foreground">
            Portfolio daily cost (sum of each deployment&apos;s cost_tokens_usd_day
            series). Daily token budget reference: {DAILY_TOKEN_BUDGET_REFERENCE.toLocaleString()}{" "}
            tokens/day (static demo cap) — this chart plots USD cost, not raw
            token counts, so the budget line is shown as an annotation, not a
            literal axis value.
          </p>
          {data.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-center">
              <EmptySeriesIcon className="size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No cost telemetry available.</p>
              <p className="text-xs text-muted-foreground/70">
                Cost series populate once a deployment starts serving.
              </p>
            </div>
          ) : (
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 52, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="ts"
                    interval={tickInterval}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--chart-axis)" }}
                    tickLine={{ stroke: "var(--chart-axis)" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--chart-axis)" }}
                    tickLine={false}
                    width={52}
                    domain={[(min: number) => Math.floor(min * 0.9), (max: number) => Math.ceil(max * 1.15)]}
                    tickFormatter={(v: number) => `$${v}`}
                  />
                  <RechartsTooltip
                    content={<CostTooltip />}
                    cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "4 4" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalUsd"
                    name={SERIES_NAME}
                    stroke={SERIES_COLOR}
                    strokeWidth={2}
                    fill={SERIES_COLOR}
                    fillOpacity={0.12}
                    dot={makeEndLabelDot(data.length, sparse)}
                    activeDot={{ r: 5, fill: SERIES_COLOR, stroke: "var(--card)", strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Daily token budget: {DAILY_TOKEN_BUDGET_REFERENCE.toLocaleString()} (synthetic demo cap
            — not read from a live budget store).
          </p>
        </SyntheticDataLabel>
      </CardContent>
    </Card>
  );
}
