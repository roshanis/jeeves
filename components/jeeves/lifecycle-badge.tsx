import {
  FilePlus2,
  FileClock,
  ListChecks,
  FileSearch,
  Zap,
  CheckCircle2,
  FileCheck2,
  XCircle,
  Rocket,
  PauseCircle,
  RotateCcw,
  Archive,
  type LucideIcon,
} from "lucide-react";
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

type Tone = "good" | "neutral" | "serious" | "critical";

// Lifecycle states ride the shared reserved status family (app/globals.css
// data-color contract): approved/fast-lane/conditional/deployed = good,
// draft/queue states = neutral (in progress, not yet a problem),
// paused/re-review = serious (needs attention), rejected = critical,
// retired = neutral-muted (settled, out of scope). Each state also carries
// its own icon so state is never color alone.
const LIFECYCLE_META: Record<LifecycleState, { tone: Tone; icon: LucideIcon }> = {
  intake_draft: { tone: "neutral", icon: FilePlus2 },
  submitted: { tone: "neutral", icon: FileClock },
  triaged: { tone: "neutral", icon: ListChecks },
  in_review: { tone: "neutral", icon: FileSearch },
  fast_lane_approved: { tone: "good", icon: Zap },
  approved: { tone: "good", icon: CheckCircle2 },
  conditionally_approved: { tone: "good", icon: FileCheck2 },
  rejected: { tone: "critical", icon: XCircle },
  deployed: { tone: "good", icon: Rocket },
  paused: { tone: "serious", icon: PauseCircle },
  re_review: { tone: "serious", icon: RotateCcw },
  retired: { tone: "neutral", icon: Archive },
};

const TONE_CLASS: Record<Tone, string> = {
  good: "bg-status-good-bg text-status-good-fg",
  neutral: "bg-status-neutral-bg text-status-neutral-fg",
  serious: "bg-status-serious-bg text-status-serious-fg",
  critical: "bg-status-critical-bg text-status-critical-fg",
};

export function LifecycleBadge({
  state,
  className,
}: {
  state: LifecycleState;
  className?: string;
}) {
  const { tone, icon: Icon } = LIFECYCLE_META[state];
  return (
    <span
      data-slot="lifecycle-badge"
      data-state={state}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {LIFECYCLE_LABEL[state]}
    </span>
  );
}
