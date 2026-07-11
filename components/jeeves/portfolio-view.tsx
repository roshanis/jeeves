"use client";

import * as React from "react";
import type { InitiativeSummary } from "@/lib/data/dto";
import { InitiativeTable } from "./initiative-table";

// Saved views (Codex design review): quick operational filters over the full
// portfolio. Client-side so switching is instant; the table underneath keeps
// its own sort.
const VIEWS = [
  { id: "all", label: "All", test: () => true },
  { id: "critical", label: "Critical", test: (i: InitiativeSummary) => i.tier === "critical" },
  { id: "in-review", label: "In review", test: (i: InitiativeSummary) => i.state === "in_review" },
  {
    id: "breached",
    label: "Breached / paused",
    test: (i: InitiativeSummary) =>
      i.overdue || i.state === "paused" || i.state === "re_review",
  },
  {
    id: "deployed",
    label: "Deployed",
    test: (i: InitiativeSummary) =>
      i.state === "deployed" || i.state === "fast_lane_approved",
  },
] as const;

export function PortfolioView({ initiatives }: { initiatives: InitiativeSummary[] }) {
  const [view, setView] = React.useState<(typeof VIEWS)[number]["id"]>("all");
  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const rows = initiatives.filter(active.test);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Saved views">
        {VIEWS.map((v) => {
          const count = initiatives.filter(v.test).length;
          const isActive = v.id === view;
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(v.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
              <span className={`ml-1.5 tabular-nums ${isActive ? "text-primary-foreground/70" : "text-muted-foreground/70"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <InitiativeTable initiatives={rows} caption={`Portfolio — ${active.label}`} />
    </div>
  );
}
