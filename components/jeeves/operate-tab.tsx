"use client";

// Operate tab (ui-spec §3.6): cost / eval / GPU panels from Observation
// series. EVERY panel is wrapped in SyntheticDataLabel ("Synthetic data —
// demo" + "Arize: not connected") — no exceptions, per plan §7 / Codex F6.
// GPU panel renders only when a gpu_util_pct series exists (only #6
// claims-ocr-coder); it is absent entirely, not zeroed-out, elsewhere.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DeploymentRow, TelemetrySeries } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SyntheticDataLabel } from "./synthetic-data-label";
import { DisableWithTooltip } from "./role-gate";

const KIND_TITLE: Record<TelemetrySeries["kind"], string> = {
  cost_tokens_usd_day: "Cost — daily token spend (USD)",
  eval_hallucination: "Eval — hallucination rate",
  eval_relevance: "Eval — relevance",
  gpu_util_pct: "GPU utilization (%)",
};

// Deterministic offline-eval comparison for #5's v2.0 -> v2.1 promotion
// story (seed-spec §4: "v2.0->v2.1 offline eval comparison instead of live
// drift"). Fixed constants — this is a synthetic fixture, not telemetry.
const PROMOTION_EVAL_COMPARISON = [
  { metric: "Hallucination", "v2.0": 0.042, "v2.1": 0.031 },
  { metric: "Relevance", "v2.0": 0.87, "v2.1": 0.91 },
  { metric: "Completeness", "v2.0": 0.82, "v2.1": 0.88 },
];

function shortDate(ts: string): string {
  return ts.slice(5, 10);
}

function SeriesPanel({ series }: { series: TelemetrySeries }) {
  const data = series.points.map((p) => ({ ts: shortDate(p.ts), value: p.value }));

  return (
    <Card data-slot="telemetry-panel" data-kind={series.kind}>
      <CardHeader>
        <CardTitle className="text-sm">{KIND_TITLE[series.kind]}</CardTitle>
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
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <RechartsTooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-chart-3, #666)"
                  strokeWidth={2}
                  dot={false}
                />
                {series.threshold !== null ? (
                  <ReferenceLine
                    y={series.threshold}
                    stroke="#dc2626"
                    strokeDasharray="4 4"
                    label={{
                      value: `threshold ${series.threshold}`,
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
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={PROMOTION_EVAL_COMPARISON} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="v2.0" fill="#94a3b8" />
                <Bar dataKey="v2.1" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SyntheticDataLabel>
      </CardContent>
    </Card>
  );
}

const DEPLOYMENT_STATUS_LABEL: Record<DeploymentRow["status"], string> = {
  deployed: "Deployed",
  paused: "Paused",
  awaiting_promotion_signoff: "Awaiting promotion sign-off",
  retired: "Retired",
};

export function OperateTab({
  slug,
  telemetry,
  deployments,
}: {
  slug: string;
  telemetry: TelemetrySeries[];
  deployments: DeploymentRow[];
}) {
  const isPromotionStory = slug === "pa-correspondence-model";
  const evalSeries = telemetry.filter((s) => s.kind === "eval_hallucination" || s.kind === "eval_relevance");
  const costSeries = telemetry.filter((s) => s.kind === "cost_tokens_usd_day");
  const gpuSeries = telemetry.filter((s) => s.kind === "gpu_util_pct");

  return (
    <div className="space-y-4" data-slot="operate-tab">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Operate</h3>
        {/* Admin-shaped action, rendered disabled for every role in this
            read-only build (auth gating; see role-gate.tsx). */}
        <DisableWithTooltip label="Run monitor" variant="outline" />
      </div>

      {deployments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {deployments.map((d) => (
            <Badge key={d.version} variant={d.status === "deployed" ? "default" : "secondary"}>
              {d.version} — {DEPLOYMENT_STATUS_LABEL[d.status]}
            </Badge>
          ))}
        </div>
      ) : null}

      {telemetry.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No telemetry for this initiative — it has no active deployment.
        </p>
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
