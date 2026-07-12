"use client";

// Shared queue-aging UI primitives, used by both the reviews workbench
// (components/jeeves/review-workbench.tsx) and the role-aware Inbox reviewer
// queue (components/jeeves/role-aware-inbox.tsx) so the "Age" column and the
// per-queue aging pill look and behave identically everywhere. The aging math
// lives in lib/format/aging.ts (pure, unit-tested); this module only supplies
// the hydration-safe clock and the small badge/cell components.
import * as React from "react";
import type { ReviewRow } from "@/lib/data/dto";
import { ageBucket, ageMsSince, formatAge, type AgeBucket } from "@/lib/format/aging";

const AGE_BUCKET_CLASSES: Record<AgeBucket, string> = {
  fresh: "bg-muted text-muted-foreground",
  aging: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  overdue: "bg-destructive/10 text-destructive",
};

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
  return (
    <span
      className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${AGE_BUCKET_CLASSES[ageBucket(ageMs)]}`}
      title="Oldest review waiting in this queue"
    >
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
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${AGE_BUCKET_CLASSES[ageBucket(ageMs)]}`}
      title={`In queue since ${createdAt.slice(0, 10)}`}
    >
      {formatAge(ageMs)}
    </span>
  );
}
