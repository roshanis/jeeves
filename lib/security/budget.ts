/**
 * Daily token budget enforcement (plan §3 / AGENTS.md hard rule 2: "atomic
 * `run_budget` check"). Pure logic, framework/DB-agnostic — a real Postgres
 * `RunBudget`-backed implementation of `BudgetStore` lands later; this
 * module defines the interface plus an in-memory implementation for tests
 * and for any short-lived demo-workspace usage that doesn't need
 * persistence across process restarts.
 */

/**
 * Persistence boundary for daily usage totals. A DB-backed implementation
 * (Neon/Drizzle `RunBudget` table, per plan §5) will implement this same
 * interface later — callers of `reserve`/`checkBudget` don't need to
 * change.
 */
export interface BudgetStore {
  getUsed(day: string): Promise<number>;
  addUsage(day: string, tokens: number): Promise<void>;
}

export class InMemoryBudgetStore implements BudgetStore {
  private readonly usage = new Map<string, number>();

  async getUsed(day: string): Promise<number> {
    return this.usage.get(day) ?? 0;
  }

  async addUsage(day: string, tokens: number): Promise<void> {
    const current = this.usage.get(day) ?? 0;
    this.usage.set(day, current + tokens);
  }
}

export interface BudgetCheckResult {
  granted: boolean;
  /**
   * Budget currently remaining for the day (`dailyCap - used`), i.e. the
   * state *before* this hypothetical request — matches the "Demo budget:
   * 42/50 actions today" UI indicator (docs/ui-spec.md §8), which reports
   * what's left right now, not a post-request projection.
   */
  remaining: number;
}

/**
 * Non-committing preview: would `requested` tokens fit under `dailyCap`
 * given `store`'s current usage for `day`? Does not reserve/record
 * anything — use `reserve` for the atomic, committing version. Useful for
 * UI-side "budget remaining" displays (docs/ui-spec.md §8 budget
 * indicator) where no actual consumption should occur.
 */
export async function checkBudget(
  store: BudgetStore,
  day: string,
  requested: number,
  dailyCap: number,
): Promise<BudgetCheckResult> {
  const used = await store.getUsed(day);
  const wouldBeUsed = used + requested;
  const granted = wouldBeUsed <= dailyCap;
  const remaining = Math.max(0, dailyCap - used);
  return { granted, remaining };
}

export interface ReserveResult {
  granted: boolean;
  /** Remaining budget for the day after this reservation (reflects committed usage; 0 when at or over cap). */
  remaining: number;
}

/**
 * Per-day serialization so concurrent `reserve` calls against the same day
 * can never race past the cap (the module-level concern this function
 * exists to solve — see the "20 parallel reserves" concurrency test).
 *
 * Each day's key gets its own promise chain: every `reserve` call for that
 * day appends its critical section (read usage -> decide -> write usage)
 * onto the tail of the chain and awaits its turn, so the read-then-write is
 * effectively atomic per day without needing a real DB transaction. Chains
 * for different days run fully independently/concurrently.
 *
 * This map is process-local (in-memory), matching the "pure logic" design
 * mandate — a DB-backed implementation would instead use a real
 * transaction/row lock inside `BudgetStore`, but the serialization
 * guarantee at this layer still protects any store implementation that
 * itself does non-atomic read-then-write internally.
 *
 * TODO(P4): add pruneDayChains(olderThanDay) — one entry accumulates per
 * distinct day key and is never pruned; negligible for the demo, unbounded
 * for a long-lived server (review finding #7).
 */
const dayChains = new Map<string, Promise<unknown>>();

function runExclusive<T>(day: string, fn: () => Promise<T>): Promise<T> {
  const previous = dayChains.get(day) ?? Promise.resolve();
  // Chain onto the previous link regardless of whether it resolved or
  // rejected, so one failure can't wedge the queue for this day forever.
  const next = previous.then(fn, fn);
  // Store a settled-safe tail so subsequent callers wait for this link too,
  // but don't let an eventual rejection propagate into unrelated callers'
  // `.then` chains as an unhandled rejection.
  dayChains.set(
    day,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Atomically reserve `requested` tokens against `day`'s budget: grants and
 * commits the usage in one serialized step if `used + requested <=
 * dailyCap`, otherwise denies and commits nothing. Safe under concurrent
 * calls for the same day (see `runExclusive`).
 */
export async function reserve(
  store: BudgetStore,
  day: string,
  requested: number,
  dailyCap: number,
): Promise<ReserveResult> {
  return runExclusive(day, async () => {
    const used = await store.getUsed(day);
    const wouldBeUsed = used + requested;
    if (wouldBeUsed > dailyCap) {
      return { granted: false, remaining: Math.max(0, dailyCap - used) };
    }
    await store.addUsage(day, requested);
    return { granted: true, remaining: dailyCap - wouldBeUsed };
  });
}
