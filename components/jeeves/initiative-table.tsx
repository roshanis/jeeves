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

/** Compact owner identity — an initials-avatar chip only (full name on
 * hover via the title attribute). Column-priority fix (design review
 * problem #3): this used to reveal the full name inline once the viewport
 * crossed `xl`, which is the exact width where the right-rail layout also
 * engages — the two changes compounded into the measured clipping. Staying
 * chip-only at every width removes that compounding column entirely. */
function OwnerCell({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center" title={name}>
      <Avatar size="sm">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
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
  const ariaSort: React.AriaAttributes["aria-sort"] = active
    ? dir === 1
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th
      aria-sort={ariaSort}
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        onClick={() => onToggle(k)}
        /* .touch-min: the sort control is only ~16px tall by design (it is a
           column label, not a button) — far too small for a fingertip. It
           takes a real 44px minimum on touch pointers rather than an overlay,
           because this header sits inside a horizontally-scrolling container
           whose clipping would have swallowed an overlay that extended above
           the first row (measured: 1 of 4 probe edges reachable). */
        className={`touch-min inline-flex items-center gap-1 whitespace-nowrap rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {children}
        <Icon className={`h-3 w-3 ${active ? "opacity-90" : "opacity-40"}`} aria-hidden />
      </button>
    </th>
  );
}

/** Slim 2px severity-stripe cell — leading indicator column so SLA-breached
 * or Critical-tier rows read as urgent at a glance without scanning the row.
 * Decorative (aria-hidden); the badges elsewhere in the row still carry the
 * same information as text/icon, so nothing is color-only. */
function SeverityStripeCell({ severe }: { severe: boolean }) {
  return (
    <td className="w-0.5 min-w-0.5 p-0" aria-hidden>
      <span
        className={`block h-full w-full ${severe ? "bg-status-critical-fg" : "bg-transparent"}`}
      />
    </td>
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
    // @container: column priority below is keyed to the TABLE'S OWN
    // available width (container queries), not the page viewport. The old
    // `lg:`/`xl:` viewport breakpoints hid columns based on window size, but
    // this table sits in a grid column that shrinks a lot once the right
    // rail appears (role-aware-inbox.tsx's `xl:grid-cols-[2fr_1fr]` split) —
    // at exactly that same `xl` viewport width the old "Next action" column
    // ALSO turned on, and the two changes compounded into the measured
    // 21-32% clipping (design review problem #3). Container queries hide
    // columns based on the space this table actually has, so the fix holds
    // regardless of what else is on the page.
    <div
      className="panel card-quiet scroll-thin scroll-x-pane @container overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-slot="initiative-table"
      tabIndex={0}
      role="region"
      aria-label={caption ?? "Initiatives table"}
    >
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b bg-muted/50 text-[11px] uppercase tracking-wide">
          <tr>
            <th className="w-0.5 min-w-0.5 p-0" aria-hidden />
            <Th k="title" activeKey={sort} dir={dir} onToggle={toggle} className="w-full min-w-[11rem]">
              Initiative
            </Th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Owner</th>
            <Th k="tier" activeKey={sort} dir={dir} onToggle={toggle}>Tier</Th>
            <Th k="state" activeKey={sort} dir={dir} onToggle={toggle}>State</Th>
            <Th k="age" activeKey={sort} dir={dir} onToggle={toggle} align="right">Age</Th>
            <Th k="sla" activeKey={sort} dir={dir} onToggle={toggle}>SLA</Th>
            <Th
              k="reviews"
              activeKey={sort}
              dir={dir}
              onToggle={toggle}
              align="right"
              className="hidden @2xl:table-cell"
            >
              Reviews
            </Th>
            <th className="hidden px-2 py-2 text-left font-medium text-muted-foreground @4xl:table-cell">
              Next action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const severe = i.overdue || i.tier === "critical";
            return (
              <tr
                key={i.slug}
                data-slot="initiative-row"
                data-severity={severe ? "true" : "false"}
                className="h-10 border-b last:border-0 hover:bg-muted/40"
              >
                <SeverityStripeCell severe={severe} />
                <td className="max-w-[11rem] px-2 py-1.5 @2xl:max-w-[18rem] @4xl:max-w-[26rem]">
                  {/* touch-target: at 56px coarse-pointer row pitch the 44px
                      overlay stays inside the row, and the positioned link
                      paints above the static slug line + header row, so a
                      fingertip anywhere in the row's upper band reaches the
                      link (mobile pass: title links measured 20px tall and
                      probed 2/4 without it). */}
                  <Link
                    href={`/initiatives/${i.slug}`}
                    className="touch-target block font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {/* truncate lives on an inner span: overflow:hidden on
                        the link itself would clip the touch-target overlay
                        back down to the 20px text box. */}
                    <span className="block truncate">{i.title}</span>
                  </Link>
                  <div className="label-mono truncate text-muted-foreground">{i.slug}</div>
                </td>
                <td className="px-2 py-1.5">
                  <OwnerCell name={i.requester} />
                </td>
                <td className="px-2 py-1.5"><TierBadge tier={i.tier} /></td>
                <td className="px-2 py-1.5"><LifecycleBadge state={i.state} /></td>
                <td className="px-2 py-1.5 text-right">
                  <InitiativeAgeCell updatedAt={i.updatedAt} state={i.state} nowMs={nowMs} />
                </td>
                <td className="px-2 py-1.5">
                  {i.overdue ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-status-serious-bg px-1.5 py-0.5 font-mono text-[11px] font-medium text-status-serious-fg">
                      <TriangleAlert className="h-3 w-3" aria-hidden /> Breach
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                      <CircleCheck className="h-3 w-3" aria-hidden /> OK
                    </span>
                  )}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground @2xl:table-cell">
                  {i.domainsSigned}/{i.domainsRequired}
                </td>
                <td className="hidden px-2 py-1.5 text-xs text-muted-foreground @4xl:table-cell">
                  {NEXT_ACTION[i.state]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
