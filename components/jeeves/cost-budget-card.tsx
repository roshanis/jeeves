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
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

function shortDate(ts: string): string {
  return ts.slice(5, 10);
}

export interface PortfolioCostPoint {
  ts: string;
  totalUsd: number;
}

export function CostBudgetCard({ points }: { points: PortfolioCostPoint[] }) {
  const data = points.map((p) => ({ ts: shortDate(p.ts), totalUsd: p.totalUsd }));

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
            <p className="text-sm text-muted-foreground">No cost telemetry available.</p>
          ) : (
            <div className="h-56 w-full overflow-x-auto">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <RechartsTooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="totalUsd"
                    name="Portfolio cost/day (USD)"
                    stroke="var(--color-chart-3, #666)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
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
