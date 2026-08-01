import type { OverlayFlags } from "@/lib/domain/types";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Overlay-flag metadata: each entry names the boolean *value* that raises
 * risk for that flag. Five flags are risk-increasing when Y (PHI,
 * member-facing, care/coverage influence, vendor-hosted, individual
 * impact); human-in-loop inverts — a qualified human NOT reviewing output
 * (N) is the risk-increasing value, not Y. Encode riskiness per flag, never
 * assume "Y = risky" globally.
 */
const FLAG_META: { key: keyof OverlayFlags; label: string; riskyWhen: boolean }[] = [
  { key: "phi", label: "PHI", riskyWhen: true },
  { key: "memberFacing", label: "Member-facing", riskyWhen: true },
  { key: "careCoverageInfluence", label: "Care/coverage", riskyWhen: true },
  { key: "vendorHosted", label: "Vendor-hosted", riskyWhen: true },
  { key: "humanInLoop", label: "Human-in-loop", riskyWhen: false },
  { key: "individualImpact", label: "Individual impact", riskyWhen: true },
];

/** Overlay-flag chip row shown in the Initiative header (ui-spec §3). */
export function OverlayFlagChips({ flags }: { flags: OverlayFlags }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-slot="overlay-flag-chips">
      {FLAG_META.map(({ key, label, riskyWhen }) => {
        const value = flags[key];
        const isRisky = value === riskyWhen;
        return (
          <span
            key={key}
            data-slot="overlay-flag-chip"
            data-risky={isRisky}
            className={cn(
              "inline-flex h-5 w-fit items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
              isRisky
                ? "border-transparent bg-status-warning-bg text-status-warning-fg"
                : "border-border bg-transparent text-muted-foreground",
            )}
          >
            {isRisky ? <AlertTriangle className="size-3" aria-hidden /> : null}
            {label}: {value ? "Y" : "N"}
          </span>
        );
      })}
    </div>
  );
}
