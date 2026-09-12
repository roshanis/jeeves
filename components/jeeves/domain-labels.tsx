// Shared, server-safe domain/status display primitives. Extracted from
// reviews-tab.tsx when that component became a client component (live
// draft-run polling): server components (overview-tab, controls-tab,
// control-catalog) keep importing these plain values from here without
// crossing the client-module boundary.
import type { ReviewRow } from "@/lib/data/dto";
import { cn } from "@/lib/utils";

// The map itself now lives in lib/domain/labels.ts — pure data, importable
// from the service layer without dragging JSX along (this module also
// exports a component). Re-exported here so existing importers are
// unaffected.
export { DOMAIN_LABEL } from "@/lib/domain/labels";

const STATUS_CLASS: Record<ReviewRow["status"], string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  drafted: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  signed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  returned: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  pending: "Not started",
  drafted: "Drafted",
  signed: "Signed",
  returned: "Returned",
};

export function ReviewStatusBadge({ status }: { status: ReviewRow["status"] }) {
  return (
    <span
      data-slot="review-status"
      data-status={status}
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
