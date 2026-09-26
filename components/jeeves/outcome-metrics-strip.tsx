"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { OutcomeMetrics } from "@/lib/data/dto";

const TOOLTIP_TEXT = "Computed from seeded/live data — see Audit tab for source events.";

// Instrument-deck segment (2026-08-02 pass): the strip is one hairline-
// divided panel, not five separate floating cards — matches the status band
// on the Inbox so every "readout row" in the console reads as one
// instrument. Each segment keeps its own kicker/value/subtext anatomy.
function OutcomeMetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div data-slot="outcome-metric-card" className="flex min-w-0 flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{label}</span>
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
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="stat-value text-2xl text-foreground">{value}</div>
          {subtext ? <div className="label-mono mt-1 normal-case text-muted-foreground">{subtext}</div> : null}
        </div>
      </div>
    </div>
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
      className="panel card-quiet grid grid-cols-1 divide-y divide-border sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0"
    >
      <OutcomeMetricCard
        label="Review cycle time"
        value={`${metrics.medianReviewCycleDays}d`}
        subtext="median, recent cycles"
      />
      <OutcomeMetricCard
        label="First-pass completeness"
        value={`${metrics.firstPassCompletenessPct}%`}
        subtext="intakes complete on first submit"
      />
      <OutcomeMetricCard
        label="Reviewer hours saved"
        value={`~${metrics.reviewerHoursSavedPerReview}h`}
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
