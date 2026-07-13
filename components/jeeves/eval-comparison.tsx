/**
 * EvalComparison — read-only eval-metric side-by-side for a promotion
 * candidate vs the current deployed version (M3 promotion-view extension,
 * deliverable 2).
 *
 * HONESTY NOTE (per task brief): the seeded/mock telemetry
 * (`lib/data/dto.ts#TelemetrySeries`) is attached to an initiative's
 * OPERATIONAL deployment as a whole (`db-provider.ts#operationalDeployment` /
 * mock-provider.ts's per-slug series) — there is no separate eval series
 * recorded per CANDIDATE checkpoint distinct from the live version's series.
 * So this component does NOT fabricate a "candidate's own eval numbers";
 * it shows the initiative's current `eval_hallucination` series (latest
 * value, trend over the last N points, and threshold) and labels it plainly
 * as "the initiative's live eval series" — the honest comparison available
 * today is candidate-vs-threshold using the same monitored series the
 * initiative is already gated on, not candidate-vs-predecessor-version.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";

export interface EvalSeriesLike {
  kind: string;
  points: { ts: string; value: number }[];
  threshold: number | null;
}

function trend(points: { ts: string; value: number }[]): "up" | "down" | "flat" | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!.value;
  const prev = points[points.length - 2]!.value;
  if (last > prev) return "up";
  if (last < prev) return "down";
  return "flat";
}

const TREND_ARROW: Record<"up" | "down" | "flat", string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

const TREND_LABEL: Record<"up" | "down" | "flat", string> = {
  up: "rising",
  down: "falling",
  flat: "flat",
};

const EVAL_METRIC_LABEL: Record<string, string> = {
  eval_hallucination: "Hallucination rate",
  eval_relevance: "Relevance score",
};

export function EvalComparison({
  candidateVersion,
  currentVersion,
  evalSeries,
}: {
  /** The checkpoint proposed for promotion, e.g. "v2.1". */
  candidateVersion: string;
  /** The version currently deployed and serving, e.g. "v2.0" (or null if none). */
  currentVersion: string | null;
  /**
   * The initiative's live `eval_hallucination` (or `eval_relevance`)
   * TelemetrySeries, if one exists — this is the initiative's OPERATIONAL
   * series, not a per-version one (see file-level honesty note).
   */
  evalSeries: EvalSeriesLike | null;
}) {
  if (!evalSeries || evalSeries.points.length === 0) {
    return (
      <SyntheticDataLabel>
        <Card data-slot="eval-comparison">
          <CardHeader className="py-2.5">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Eval comparison — {candidateVersion}
              {currentVersion ? ` vs ${currentVersion}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No eval telemetry is recorded for this initiative.
            </p>
          </CardContent>
        </Card>
      </SyntheticDataLabel>
    );
  }

  const latest = evalSeries.points[evalSeries.points.length - 1]!;
  const t = trend(evalSeries.points);
  const threshold = evalSeries.threshold;
  const overThreshold = threshold !== null && latest.value > threshold;
  const metricLabel = EVAL_METRIC_LABEL[evalSeries.kind] ?? evalSeries.kind;

  return (
    <SyntheticDataLabel>
      <Card data-slot="eval-comparison">
        <CardHeader className="py-2.5">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Eval comparison — {candidateVersion}
            {currentVersion ? ` vs ${currentVersion}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {metricLabel} compared: the initiative&apos;s live eval series
            (not a per-checkpoint series — the candidate checkpoint has not
            yet run its own separate eval telemetry) against the runtime
            threshold this deployment is gated on.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums" data-slot="eval-comparison-latest">
              {latest.value.toFixed(4)}
            </span>
            {t ? (
              <span
                className="text-sm text-muted-foreground"
                data-slot="eval-comparison-trend"
                aria-label={`trend ${TREND_LABEL[t]}`}
              >
                {TREND_ARROW[t]} {TREND_LABEL[t]}
              </span>
            ) : null}
            {threshold !== null ? (
              <Badge variant={overThreshold ? "destructive" : "secondary"} data-slot="eval-comparison-threshold">
                threshold {threshold.toFixed(4)}
              </Badge>
            ) : (
              <Badge variant="outline">no threshold set</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Latest observation at {latest.ts.slice(0, 10)}.
            {overThreshold ? " Currently above threshold." : threshold !== null ? " Within threshold." : ""}
          </p>
        </CardContent>
      </Card>
    </SyntheticDataLabel>
  );
}
