"use client";

// Shared queue-aging UI primitives, used by both the reviews workbench
// (components/jeeves/review-workbench.tsx) and the role-aware Inbox reviewer
// queue (components/jeeves/role-aware-inbox.tsx) so the "Age" column and the
// per-queue aging pill look and behave identically everywhere. The aging math
// lives in lib/format/aging.ts (pure, unit-tested); this module only supplies
// the hydration-safe clock and the small badge/cell components.
import * as React from "react";
import type { ReviewRow } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { ageBucket, ageMsSince, formatAge, type AgeBucket } from "@/lib/format/aging";

// Lifecycle states where an initiative is settled/terminal — aging is
// informational, not a bottleneck signal, so its age is shown muted (never
// amber/red) in the portfolio/Inbox "Age" column.
const SETTLED_STATES = new Set<LifecycleState>([
  "approved",
  "fast_lane_approved",
  "rejected",
  "deployed",
  "retired",
]);

// Status-family tint per bucket. `overdue` keeps the literal
// `text-destructive` utility (== --status-critical value, see globals.css)
// so the aging tests' class assertions stay meaningful without duplicating
// the token.
const AGE_BUCKET_CLASSES: Record<AgeBucket, string> = {
  fresh: "bg-status-neutral-bg text-muted-foreground",
  aging: "bg-status-warning-bg text-status-warning-fg",
  overdue: "bg-status-critical-bg text-destructive",
};

// Matching dot color per bucket — status is never color alone, but the dot
// reinforces the tint at a glance next to the age text.
const AGE_BUCKET_DOT_CLASSES: Record<AgeBucket, string> = {
  fresh: "bg-muted-foreground/60",
  aging: "bg-status-warning-fg",
  overdue: "bg-destructive",
};

function AgeDot({ bucket }: { bucket: AgeBucket }) {
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${AGE_BUCKET_DOT_CLASSES[bucket]}`}
      aria-hidden
    />
  );
}

// Hydration-safe "current time": null on the server (so SSR + first client
// render match and show the placeholder), then a single cached client clock
// read. Cached so useSyncExternalStore sees a stable snapshot — the aging view
// doesn't need a live-ticking clock, and this avoids both a hydration mismatch
// and a setState-in-effect re-render.
const SUBSCRIBE_NOOP = (): (() => void) => () => {};
let cachedClientNow: number | null = null;
function getClientNow(): number {
  if (cachedClientNow === null) cachedClientNow = Date.now();
  return cachedClientNow;
}
function getServerNow(): number | null {
  return null;
}

export function useClientNow(): number | null {
  return React.useSyncExternalStore(SUBSCRIBE_NOOP, getClientNow, getServerNow);
}

/**
 * Oldest still-waiting (unsigned) age in ms across `reviews`, or null when
 * there is nothing waiting / the clock isn't mounted yet. Drives each queue's
 * aging pill.
 */
export function oldestUnsignedAgeMs(
  reviews: { status: ReviewRow["status"]; createdAt: string }[],
  nowMs: number | null,
): number | null {
  if (nowMs === null) return null;
  const ages = reviews
    .filter((r) => r.status !== "signed")
    .map((r) => ageMsSince(r.createdAt, nowMs));
  return ages.length > 0 ? Math.max(...ages) : null;
}

/** Small colored age pill for a queue (oldest waiting item). */
export function QueueAgingBadge({ ageMs }: { ageMs: number | null }) {
  if (ageMs === null) return null;
  const bucket = ageBucket(ageMs);
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${AGE_BUCKET_CLASSES[bucket]}`}
      title="Oldest review waiting in this queue"
    >
      <AgeDot bucket={bucket} />
      {formatAge(ageMs)}
    </span>
  );
}

/**
 * Per-row "Age" cell for an INITIATIVE table — time in the current lifecycle
 * state (from updatedAt). Color-coded by bucket for active/waiting states; a
 * settled/terminal state shows its age muted (aging isn't a bottleneck there).
 * "—" when no timestamp is available (fixture/slug-only contexts).
 */
export function InitiativeAgeCell({
  updatedAt,
  state,
  nowMs,
}: {
  updatedAt?: string;
  state: LifecycleState;
  nowMs: number | null;
}) {
  if (!updatedAt) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (nowMs === null) {
    return <span className="text-muted-foreground tabular-nums">·</span>;
  }
  const ageMs = ageMsSince(updatedAt, nowMs);
  const settled = SETTLED_STATES.has(state);
  const bucket = ageBucket(ageMs);
  const cls = settled ? "bg-status-neutral-bg text-muted-foreground" : AGE_BUCKET_CLASSES[bucket];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${cls}`}
      title={`In "${state}" since ${updatedAt.slice(0, 10)}`}
    >
      {settled ? (
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
      ) : (
        <AgeDot bucket={bucket} />
      )}
      {formatAge(ageMs)}
    </span>
  );
}

/** Per-row "Age" cell — waiting time for unsigned reviews, muted dash once signed. */
export function QueueAgeCell({
  createdAt,
  status,
  nowMs,
}: {
  createdAt: string;
  status: ReviewRow["status"];
  nowMs: number | null;
}) {
  if (status === "signed") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (nowMs === null) {
    return <span className="text-muted-foreground tabular-nums">·</span>;
  }
  const ageMs = ageMsSince(createdAt, nowMs);
  const bucket = ageBucket(ageMs);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${AGE_BUCKET_CLASSES[bucket]}`}
      title={`In queue since ${createdAt.slice(0, 10)}`}
    >
      <AgeDot bucket={bucket} />
      {formatAge(ageMs)}
    </span>
  );
}
