/**
 * Queue-aging helpers (the /reviews workbench "Age" column + per-queue aging).
 * Pure + deterministic so the format/severity logic is unit-tested here and
 * the UI only supplies the current time (read post-mount for hydration
 * safety). "Age" = how long a review has been waiting in the queue, i.e.
 * `now - enteredQueueAt`.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type AgeBucket = "fresh" | "aging" | "overdue";

// Demo SLA thresholds for an unsigned domain review sitting in the queue.
// Deliberately modest so the seeded portfolio shows a visible spread; a real
// deployment would source these per-tier from policy.
export const AGING_THRESHOLD_MS = 5 * DAY; // >= this -> "aging" (amber)
export const OVERDUE_THRESHOLD_MS = 10 * DAY; // >= this -> "overdue" (red)

/** Severity bucket for a waiting age (ms). Negative/zero ages are "fresh". */
export function ageBucket(ageMs: number): AgeBucket {
  if (ageMs >= OVERDUE_THRESHOLD_MS) return "overdue";
  if (ageMs >= AGING_THRESHOLD_MS) return "aging";
  return "fresh";
}

/**
 * Compact human age, e.g. "just now", "42m", "6h", "3d", "3d 4h". Clamped at
 * zero (a future timestamp — e.g. a live item created a moment ago against a
 * slightly-behind client clock — reads "just now", never a negative age).
 */
export function formatAge(ageMs: number): string {
  const ms = ageMs < 0 ? 0 : ageMs;
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  // Show the trailing hours only for the first few days, where it's meaningful.
  return hours > 0 && days < 10 ? `${days}d ${hours}h` : `${days}d`;
}

/** Age (ms) of an ISO timestamp relative to `nowMs`; clamped at zero. */
export function ageMsSince(iso: string, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(iso));
}
