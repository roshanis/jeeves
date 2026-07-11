"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { OutcomeMetrics } from "@/lib/data/dto";

const TOOLTIP_TEXT = "Computed from seeded/live data — see Audit tab for source events.";

// Deterministic tiny sparkline fixtures (illustrative trend shape only, not
// raw telemetry) for the review-cycle-time card, per ui-spec §2's "sparkline
// of recent cycle times, champion case annotated once it closes faster."
const CYCLE_TIME_TREND = [14, 13, 12, 13, 11, 11, 10].map((value, i) => ({ i, value }));

function OutcomeMetricCard({
  label,
  value,
  subtext,
  sparkline,
}: {
  label: string;
  value: string;
  subtext?: string;
  sparkline?: { i: number; value: number }[];
}) {
  return (
    <Card data-slot="outcome-metric-card" className="min-w-0">
      <CardHeader className="flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <span tabIndex={0} aria-label={`About ${label}`}>
                <Info className="size-3.5 text-muted-foreground" />
              </span>
            }
          />
          <TooltipContent>{TOOLTIP_TEXT}</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          {subtext ? <div className="text-xs text-muted-foreground">{subtext}</div> : null}
        </div>
        {sparkline ? (
          <div className="h-8 w-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="currentColor"
                  className="text-primary"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The 5 Home-strip outcome-metric cards (ui-spec §2 item 2). Exactly 5 cards,
 * always, regardless of role.
 */
export function OutcomeMetricsStrip({ metrics }: { metrics: OutcomeMetrics }) {
  const staleCount = metrics.evidenceTotal - metrics.evidenceFresh;

  return (
    <div
      data-slot="outcome-metrics-strip"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <OutcomeMetricCard
        label="Review cycle time"
        value={`${metrics.medianReviewCycleDays}d`}
        subtext="median, recent cycles"
        sparkline={CYCLE_TIME_TREND}
      />
      <OutcomeMetricCard
        label="First-pass completeness"
        value={`${metrics.firstPassCompletenessPct}%`}
        subtext="intakes complete on first submit"
      />
      <OutcomeMetricCard
        label="Reviewer hours saved"
        value={`~${metrics.reviewerHoursSaved}h`}
        subtext="per review, drafted vs. scratch"
      />
      <OutcomeMetricCard
        label="Evidence freshness"
        value={`${metrics.evidenceFresh}/${metrics.evidenceTotal}`}
        subtext={staleCount > 0 ? `${staleCount} stale` : "all fresh"}
      />
      <OutcomeMetricCard
        label="Overdue controls"
        value={`${metrics.overdueControls}`}
        subtext="click pipeline board to filter"
      />
    </div>
  );
}
