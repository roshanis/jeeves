import type { InitiativeSummary } from "@/lib/data/dto";
import type { Tier } from "@/lib/domain/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierBadge } from "@/components/jeeves/tier-badge";
import { cn } from "@/lib/utils";

const TIERS: Tier[] = ["critical", "high", "medium", "low"];

type DomainStatus = "All signed" | "In progress" | "Blocked/Returned" | "Overdue";
const STATUSES: DomainStatus[] = ["All signed", "In progress", "Blocked/Returned", "Overdue"];

function classify(init: InitiativeSummary): DomainStatus {
  if (init.overdue) return "Overdue";
  if (init.state === "rejected") return "Blocked/Returned";
  if (init.state === "in_review" && init.domainsSigned < init.domainsRequired) {
    return "In progress";
  }
  if (init.domainsSigned >= init.domainsRequired && init.domainsRequired > 0) {
    return "All signed";
  }
  return "In progress";
}

type Bucket = 0 | 1 | 2 | 3 | 4 | 5;

// Magnitude bucketed relative to the grid's own max cell count (sequential
// ramp, data-color contract §seq-1..5 — never the categorical chart-1..4
// slots, since this is a magnitude/heat encoding, not a series encoding).
function bucketFor(count: number, max: number): Bucket {
  if (count === 0 || max <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((count / max) * 5))) as Bucket;
}

const CELL_BG: Record<Bucket, string> = {
  0: "bg-muted/40",
  1: "bg-seq-1",
  2: "bg-seq-2",
  3: "bg-seq-3",
  4: "bg-seq-4",
  5: "bg-seq-5",
};

// Ink color per bucket, chosen for contrast against that bucket's fill in
// each theme (the seq ramp's light<->dark direction inverts between light
// and dark mode, so low/high buckets swap which ink reads best).
// Bucket 4 (WCAG 1.4.3 fix, 2026-08-02): white-on-seq-4 measured 4.06:1
// light / 3.48:1 dark against the numeric label (needs 4.5:1) — --seq-4
// was darkened for light mode (see globals.css) so white now clears
// 4.68:1 there, and dark mode switches ink to neutral-900 (5.16:1),
// matching the bucket-5 pattern below.
const CELL_TEXT: Record<Bucket, string> = {
  0: "text-muted-foreground",
  1: "text-foreground dark:text-white",
  2: "text-foreground dark:text-white",
  3: "text-foreground dark:text-white",
  4: "text-white dark:text-neutral-900",
  5: "text-white dark:text-neutral-900",
};

/**
 * Tier x domain-status heatmap (ui-spec §2 item 4). A styled table with
 * sequential-ramp shaded cells — an explicit, cheaper-to-build alternative to
 * a full Recharts heatmap, noted in the spec as acceptable.
 */
export function RiskHeatmap({ initiatives }: { initiatives: InitiativeSummary[] }) {
  const grid = new Map<Tier, Map<DomainStatus, number>>();
  for (const tier of TIERS) {
    grid.set(tier, new Map(STATUSES.map((s) => [s, 0])));
  }
  for (const init of initiatives) {
    const status = classify(init);
    grid.get(init.tier)!.set(status, (grid.get(init.tier)!.get(status) ?? 0) + 1);
  }

  let maxCount = 0;
  for (const tier of TIERS) {
    for (const status of STATUSES) {
      maxCount = Math.max(maxCount, grid.get(tier)!.get(status) ?? 0);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-slot="risk-heatmap">
      <div className="overflow-x-auto">
        <Table className="border-separate [border-spacing:2px]">
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent">
              <TableHead className="kicker">Tier</TableHead>
              {STATUSES.map((s) => (
                <TableHead key={s} className="kicker">
                  {s}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {TIERS.map((tier) => (
              <TableRow key={tier} className="border-b-0 hover:bg-transparent">
                <TableCell className="p-1.5">
                  <TierBadge tier={tier} />
                </TableCell>
                {STATUSES.map((status) => {
                  const count = grid.get(tier)!.get(status) ?? 0;
                  const bucket = bucketFor(count, maxCount);
                  return (
                    <TableCell key={status} className="p-0">
                      <div
                        data-slot="risk-heatmap-cell"
                        data-bucket={bucket}
                        className={cn(
                          "stat-value flex h-9 w-full min-w-12 items-center justify-center rounded-sm text-sm",
                          CELL_BG[bucket],
                          CELL_TEXT[bucket],
                        )}
                      >
                        {count}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="label-mono flex items-center gap-2" data-slot="risk-heatmap-legend">
        <span>0</span>
        <div className="flex h-2.5 w-24 overflow-hidden rounded-full" aria-hidden="true">
          <span className="flex-1 bg-seq-1" />
          <span className="flex-1 bg-seq-2" />
          <span className="flex-1 bg-seq-3" />
          <span className="flex-1 bg-seq-4" />
          <span className="flex-1 bg-seq-5" />
        </div>
        <span>
          {maxCount} initiative{maxCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
