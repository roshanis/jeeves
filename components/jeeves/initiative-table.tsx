"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown, AlertTriangle } from "lucide-react";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState, Tier } from "@/lib/domain/types";
import { TierBadge } from "./tier-badge";
import { LifecycleBadge } from "./lifecycle-badge";

const TIER_RANK: Record<Tier, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATE_RANK: Record<LifecycleState, number> = {
  re_review: 0,
  paused: 1,
  in_review: 2,
  submitted: 3,
  triaged: 4,
  intake_draft: 5,
  conditionally_approved: 6,
  approved: 7,
  fast_lane_approved: 8,
  deployed: 9,
  rejected: 10,
  retired: 11,
};

const NEXT_ACTION: Record<LifecycleState, string> = {
  intake_draft: "Submit intake",
  submitted: "Run triage",
  triaged: "Start reviews",
  in_review: "Complete reviews",
  conditionally_approved: "Meet conditions",
  approved: "Generate controls",
  fast_lane_approved: "Monitor",
  deployed: "Monitor",
  paused: "Reassess",
  re_review: "Reassess",
  rejected: "—",
  retired: "—",
};

type SortKey = "title" | "tier" | "state" | "reviews" | "sla";

function reviewsFraction(i: InitiativeSummary) {
  return i.domainsRequired === 0 ? 1 : i.domainsSigned / i.domainsRequired;
}

export function InitiativeTable({
  initiatives,
  caption,
}: {
  initiatives: InitiativeSummary[];
  caption?: string;
}) {
  const [sort, setSort] = React.useState<SortKey>("tier");
  const [dir, setDir] = React.useState<1 | -1>(1);

  const rows = React.useMemo(() => {
    const copy = [...initiatives];
    copy.sort((a, b) => {
      let d = 0;
      switch (sort) {
        case "title": d = a.title.localeCompare(b.title); break;
        case "tier": d = TIER_RANK[a.tier] - TIER_RANK[b.tier]; break;
        case "state": d = STATE_RANK[a.state] - STATE_RANK[b.state]; break;
        case "reviews": d = reviewsFraction(a) - reviewsFraction(b); break;
        case "sla": d = Number(b.overdue) - Number(a.overdue); break;
      }
      return d * dir;
    });
    return copy;
  }, [initiatives, sort, dir]);

  function toggle(key: SortKey) {
    if (key === sort) setDir((p) => (p === 1 ? -1 : 1));
    else { setSort(key); setDir(1); }
  }

  const Th = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`px-3 py-2 text-left font-medium ${className}`}>
      <button
        onClick={() => toggle(k)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-lg border bg-card" data-slot="initiative-table">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide">
          <tr>
            <Th k="title">Initiative</Th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Owner</th>
            <Th k="tier">Tier</Th>
            <Th k="state">State</Th>
            <Th k="reviews">Reviews</Th>
            <Th k="sla">SLA</Th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Next action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr
              key={i.slug}
              data-slot="initiative-row"
              className="border-b last:border-0 hover:bg-muted/40"
            >
              <td className="px-3 py-2">
                <Link href={`/initiatives/${i.slug}`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {i.title}
                </Link>
                <div className="text-xs text-muted-foreground">{i.slug}</div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{i.requester}</td>
              <td className="px-3 py-2"><TierBadge tier={i.tier} /></td>
              <td className="px-3 py-2"><LifecycleBadge state={i.state} /></td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {i.domainsSigned}/{i.domainsRequired}
              </td>
              <td className="px-3 py-2">
                {i.overdue ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Breached
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">On track</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{NEXT_ACTION[i.state]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
