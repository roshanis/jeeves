"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, CircleCheck, TriangleAlert } from "lucide-react";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState, Tier } from "@/lib/domain/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TierBadge } from "./tier-badge";
import { LifecycleBadge } from "./lifecycle-badge";
import { InitiativeAgeCell, useClientNow } from "./queue-age";

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

type SortKey = "title" | "tier" | "state" | "reviews" | "sla" | "age";

/** Sort value for the Age column: the state-change timestamp (older = smaller). Ascending puts oldest-in-state first; missing timestamps sort last. */
function ageValue(i: InitiativeSummary): number {
  return i.updatedAt ? Date.parse(i.updatedAt) : Infinity;
}

function reviewsFraction(i: InitiativeSummary) {
  return i.domainsRequired === 0 ? 1 : i.domainsSigned / i.domainsRequired;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

/** Compact owner identity — initials avatar chip, full name on hover. */
function OwnerCell({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2" title={name}>
      <Avatar size="sm">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="hidden truncate text-muted-foreground xl:inline">{name}</span>
    </span>
  );
}

// Sortable column header. Declared at module scope (not inside the table's
// render) so React doesn't remount it every render — the sort handler is
// passed in as a prop instead of closed over.
function Th({
  k,
  activeKey,
  dir,
  onToggle,
  children,
  align = "left",
  className = "",
}: {
  k: SortKey;
  activeKey: SortKey;
  dir: 1 | -1;
  onToggle: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const active = k === activeKey;
  const Icon = active ? (dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        onClick={() => onToggle(k)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {children}
        <Icon className={`h-3 w-3 ${active ? "opacity-90" : "opacity-40"}`} aria-hidden />
      </button>
    </th>
  );
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
  const nowMs = useClientNow();

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
        case "age": d = ageValue(a) - ageValue(b); break;
      }
      return d * dir;
    });
    return copy;
  }, [initiatives, sort, dir]);

  function toggle(key: SortKey) {
    if (key === sort) setDir((p) => (p === 1 ? -1 : 1));
    else { setSort(key); setDir(1); }
  }

  return (
    <div
      className="scroll-thin card-quiet overflow-x-auto rounded-lg border bg-card"
      data-slot="initiative-table"
    >
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b bg-muted/50 text-[11px] uppercase tracking-wide">
          <tr>
            <Th k="title" activeKey={sort} dir={dir} onToggle={toggle} className="min-w-[13rem]">
              Initiative
            </Th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Owner</th>
            <Th k="tier" activeKey={sort} dir={dir} onToggle={toggle}>Tier</Th>
            <Th k="state" activeKey={sort} dir={dir} onToggle={toggle}>State</Th>
            <Th k="age" activeKey={sort} dir={dir} onToggle={toggle} align="right">Age</Th>
            <Th k="reviews" activeKey={sort} dir={dir} onToggle={toggle} align="right">
              Reviews
            </Th>
            <Th k="sla" activeKey={sort} dir={dir} onToggle={toggle}>SLA</Th>
            <th className="hidden px-3 py-2 text-left font-medium text-muted-foreground lg:table-cell">
              Next action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr
              key={i.slug}
              data-slot="initiative-row"
              className="h-11 border-b last:border-0 hover:bg-muted/40"
            >
              <td className="px-3 py-2">
                <Link
                  href={`/initiatives/${i.slug}`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {i.title}
                </Link>
                <div className="font-mono text-[11px] text-muted-foreground">{i.slug}</div>
              </td>
              <td className="px-3 py-2">
                <OwnerCell name={i.requester} />
              </td>
              <td className="px-3 py-2"><TierBadge tier={i.tier} /></td>
              <td className="px-3 py-2"><LifecycleBadge state={i.state} /></td>
              <td className="px-3 py-2 text-right">
                <InitiativeAgeCell updatedAt={i.updatedAt} state={i.state} nowMs={nowMs} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {i.domainsSigned}/{i.domainsRequired}
              </td>
              <td className="px-3 py-2">
                {i.overdue ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-status-serious-fg">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Breached
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden /> On track
                  </span>
                )}
              </td>
              <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">
                {NEXT_ACTION[i.state]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
