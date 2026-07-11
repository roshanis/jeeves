import type { LifecycleState } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const LIFECYCLE_LABEL: Record<LifecycleState, string> = {
  intake_draft: "Intake",
  submitted: "Submitted",
  triaged: "Triaged",
  in_review: "In Review",
  fast_lane_approved: "Fast-Lane Approved",
  approved: "Approved",
  conditionally_approved: "Conditionally Approved",
  rejected: "Rejected",
  deployed: "Deployed",
  paused: "Paused",
  re_review: "Reassessment",
  retired: "Retired",
};

const LIFECYCLE_CLASS: Record<LifecycleState, string> = {
  intake_draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  submitted: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  triaged: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  in_review: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  fast_lane_approved: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  conditionally_approved: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  deployed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  re_review: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  retired: "bg-zinc-200 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
};

export function LifecycleBadge({
  state,
  className,
}: {
  state: LifecycleState;
  className?: string;
}) {
  return (
    <span
      data-slot="lifecycle-badge"
      data-state={state}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        LIFECYCLE_CLASS[state],
        className,
      )}
    >
      {LIFECYCLE_LABEL[state]}
    </span>
  );
}
