import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Mandatory wrapper for every Operate-tab telemetry panel (ui-spec §3.6/§9/
 * §11 — "non-negotiable... no exceptions"). Wraps a panel with a persistent
 * "Synthetic data — demo" label plus a connector-status chip
 * ("Arize: not connected" until M3, per seed-spec §4). A single shared
 * component makes the no-exceptions rule easy to enforce by construction —
 * do not render a telemetry chart without this wrapper.
 */
export function SyntheticDataLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Synthetic data — demo</Badge>
        <Badge variant="outline">Arize: not connected</Badge>
      </div>
      {children}
    </div>
  );
}
