import type { Tier } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<Tier, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

// Tier color coding rides the shared reserved status family (app/globals.css
// data-color contract): Low=neutral, Medium=blue-tinted, High=warning,
// Critical=critical. Used everywhere a tier shows (Home board, Initiative
// header, Intake preview, Audit results) for a single consistent mapping.
const TIER_TONE: Record<Tier, { bg: string; fg: string }> = {
  low: { bg: "bg-tier-low-bg", fg: "text-tier-low-fg" },
  medium: { bg: "bg-tier-medium-bg", fg: "text-tier-medium-fg" },
  high: { bg: "bg-tier-high-bg", fg: "text-tier-high-fg" },
  critical: { bg: "bg-tier-critical-bg", fg: "text-tier-critical-fg" },
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const tone = TIER_TONE[tier];
  return (
    <span
      data-slot="tier-badge"
      data-tier={tier}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold whitespace-nowrap",
        tone.bg,
        tone.fg,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", tone.fg, "bg-current")} aria-hidden />
      {TIER_LABEL[tier]}
    </span>
  );
}
