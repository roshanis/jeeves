import { FlaskConical, Plug } from "lucide-react";
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
        <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground">
          <FlaskConical className="size-3 shrink-0" aria-hidden />
          Synthetic data — demo
        </span>
        <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground">
          <Plug className="size-3 shrink-0" aria-hidden />
          Arize: not connected
        </span>
      </div>
      {children}
    </div>
  );
}
