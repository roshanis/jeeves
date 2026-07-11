import Link from "next/link";
import { cn } from "@/lib/utils";

export type EvidenceTarget = "overview" | "intake" | "reviews" | "decisions" | "controls" | "operate" | "audit";

/**
 * Deep-links from Audit results / Home SLA callouts into a specific
 * initiative's tab (ui-spec §6/§9) — "nothing in this table is a dead end."
 */
export function EvidenceLink({
  slug,
  tab = "audit",
  children,
  className,
}: {
  slug: string;
  tab?: EvidenceTarget;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/initiatives/${slug}?tab=${tab}`}
      className={cn("text-sm font-medium text-primary underline-offset-4 hover:underline", className)}
    >
      {children}
    </Link>
  );
}
