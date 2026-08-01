import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EvidenceTarget = "overview" | "intake" | "reviews" | "decisions" | "controls" | "operate" | "audit";

/**
 * Deep-links from Audit results / Home SLA callouts into a specific
 * initiative's tab (ui-spec §6/§9) — "nothing in this table is a dead end."
 *
 * Default `variant="inline"` renders the original underlined-text link used
 * in tables and callouts. `variant="nav"` (Overview tab's quick-links card)
 * renders a full-width segmented-nav row with an optional leading icon and
 * trailing chevron.
 */
export function EvidenceLink({
  slug,
  tab = "audit",
  children,
  className,
  icon: Icon,
  variant = "inline",
}: {
  slug: string;
  tab?: EvidenceTarget;
  children: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
  variant?: "inline" | "nav";
}) {
  if (variant === "nav") {
    return (
      <Link
        href={`/initiatives/${slug}?tab=${tab}`}
        data-slot="evidence-nav-link"
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent",
          className,
        )}
      >
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className="flex-1">{children}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href={`/initiatives/${slug}?tab=${tab}`}
      className={cn("text-sm font-medium text-primary underline-offset-4 hover:underline", className)}
    >
      {children}
    </Link>
  );
}
