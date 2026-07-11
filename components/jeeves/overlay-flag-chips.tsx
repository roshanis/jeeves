import type { OverlayFlags } from "@/lib/domain/types";
import { Badge } from "@/components/ui/badge";

const FLAG_META: { key: keyof OverlayFlags; label: string }[] = [
  { key: "phi", label: "PHI" },
  { key: "memberFacing", label: "Member-facing" },
  { key: "careCoverageInfluence", label: "Care/coverage" },
  { key: "vendorHosted", label: "Vendor-hosted" },
  { key: "humanInLoop", label: "Human-in-loop" },
  { key: "individualImpact", label: "Individual impact" },
];

/** Overlay-flag chip row shown in the Initiative header (ui-spec §3). */
export function OverlayFlagChips({ flags }: { flags: OverlayFlags }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FLAG_META.map(({ key, label }) => (
        <Badge key={key} variant={flags[key] ? "default" : "outline"} className="text-[11px]">
          {label}: {flags[key] ? "Y" : "N"}
        </Badge>
      ))}
    </div>
  );
}
