import type { Tier } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<Tier, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

// Tier color coding per ui-spec §3/§9: Low=green, Medium=blue, High=orange,
// Critical=red. Used everywhere a tier shows (Home board, Initiative header,
// Intake preview, Audit results) for a single consistent mapping.
const TIER_CLASS: Record<Tier, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      data-slot="tier-badge"
      data-tier={tier}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TIER_CLASS[tier],
        className,
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
