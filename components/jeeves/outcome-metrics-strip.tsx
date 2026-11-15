"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { OutcomeMetrics } from "@/lib/data/dto";

// Instrument-deck segment (2026-08-02 pass): the strip is one hairline-
// divided panel, not five separate floating cards — matches the status band
// on the Inbox so every "readout row" in the console reads as one
// instrument. Each segment keeps its own kicker/value/subtext anatomy.
function OutcomeMetricCard({
  label,
  value,
  subtext,
  tooltip,
}: {
  label: string;
  value: string;
  subtext?: string;
  tooltip: string;
}) {
  return (
    <div data-slot="outcome-metric-card" className="flex min-w-0 flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button type="button" aria-label={`About ${label}`}>
                <Info className="size-3.5 text-muted-foreground" />
              </button>
            }
          />
          <TooltipContent>{tooltip}</TooltipContent>
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
        tooltip="Median days from opening to closing a review cycle, over closed cycles."
      />
      <OutcomeMetricCard
        label="First-pass completeness"
        value={`${metrics.firstPassCompletenessPct}%`}
        subtext="intakes complete on first submit"
        tooltip="Share of first-version intakes submitted with no missing fields."
      />
      <OutcomeMetricCard
        label="Reviewer hours saved"
        value={`~${metrics.reviewerHoursSavedPerReview}h`}
        subtext="estimate per drafted review"
        tooltip="Estimate: ~4h saved per agent-drafted review. A fixed assumption, not measured from audit events."
      />
      <OutcomeMetricCard
        label="Evidence freshness"
        value={`${metrics.evidenceFresh}/${metrics.evidenceTotal}`}
        subtext={staleCount > 0 ? `${staleCount} stale` : "all fresh"}
        tooltip="Initiatives with no overdue control or pending exception, out of all initiatives."
      />
      <OutcomeMetricCard
        label="Overdue controls"
        value={`${metrics.overdueControls}`}
        subtext='see the "Breached / paused" view'
        tooltip="Controls past cadence or with a pending exception, plus returned reviews. The Breached / paused saved view lists initiatives with overdue controls, plus paused and re-review ones."
      />
    </div>
  );
}
