import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

/**
 * Name + role + avatar-initials chip, reused on Home cards, Decisions tab,
 * Admin threshold-history note, and Fast-lane badge (ui-spec §9).
 */
export function AccountableApproverChip({
  name,
  role = "VP, AI Governance",
  className,
}: {
  name: string | null;
  role?: string;
  className?: string;
}) {
  if (!name) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No accountable approver yet
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Avatar size="sm">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{role}</span>
      </span>
    </span>
  );
}
