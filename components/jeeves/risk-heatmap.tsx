import type { InitiativeSummary } from "@/lib/data/dto";
import type { Tier } from "@/lib/domain/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TIERS: Tier[] = ["critical", "high", "medium", "low"];
const TIER_LABEL: Record<Tier, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

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

function intensityClass(count: number): string {
  if (count === 0) return "bg-muted/30 text-muted-foreground";
  if (count === 1) return "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200";
  if (count === 2) return "bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100";
  return "bg-sky-300 text-sky-950 dark:bg-sky-800 dark:text-sky-50";
}

/**
 * Tier x domain-status heatmap (ui-spec §2 item 4). A styled table with
 * badge-colored cells — an explicit, cheaper-to-build alternative to a full
 * Recharts heatmap, noted in the spec as acceptable.
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

  return (
    <Table data-slot="risk-heatmap">
      <TableHeader>
        <TableRow>
          <TableHead>Tier</TableHead>
          {STATUSES.map((s) => (
            <TableHead key={s}>{s}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {TIERS.map((tier) => (
          <TableRow key={tier}>
            <TableCell className="font-medium">{TIER_LABEL[tier]}</TableCell>
            {STATUSES.map((status) => {
              const count = grid.get(tier)!.get(status) ?? 0;
              return (
                <TableCell key={status}>
                  <span
                    className={cn(
                      "inline-flex h-7 w-10 items-center justify-center rounded-md text-sm font-medium tabular-nums",
                      intensityClass(count),
                    )}
                  >
                    {count}
                  </span>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
