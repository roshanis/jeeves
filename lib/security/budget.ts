/**
 * Daily token budget enforcement (plan §3 / AGENTS.md hard rule 2: "atomic
 * `run_budget` check"). The shared interface supports both an in-memory
 * implementation for pure unit tests and a Postgres-backed implementation
 * for persistent, cross-instance enforcement.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { runBudget } from "../db/schema";

/**
 * Persistence boundary for daily usage totals. Both the in-memory unit-test
 * store and the Neon/Drizzle `RunBudget` store implement this interface, so
 * callers of `reserve`/`checkBudget` stay storage-agnostic.
 */
export interface BudgetStore {
  getUsed(day: string): Promise<number>;
  addUsage(day: string, tokens: number): Promise<void>;
  /**
   * Optional store-native atomic reserve: when present, `reserve()` below
   * delegates the whole read-check-write to the store instead of doing its
   * own read-then-write across `getUsed`/`addUsage`. Required for stores
   * that are shared across multiple processes/instances (e.g.
   * `DbBudgetStore`), where the in-process `dayChains` serialization in this
   * module can't prevent a race between two separate Node processes both
   * reading "under cap" before either writes. In-memory stores don't need
   * this — a single process's `dayChains` queue is already sufficient.
   */
  reserveAtomic?(day: string, requested: number, dailyCap: number): Promise<ReserveResult>;
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

/**
 * DB-backed `BudgetStore` over the `run_budget` table (M2.5 inc.1), so the
 * daily token budget survives a process restart / is shared across multiple
 * serverless instances rather than resetting per-instance.
 *
 * `getDb` is injected (rather than imported directly) so callers — and
 * tests — can point this at whatever `Db` handle is active, matching how
 * `lib/services/route-guard.ts` already calls `getDb()` per-request instead
 * of caching a handle at module load.
 *
 * `getUsed`/`addUsage` alone are NOT atomic under concurrency (that's what
 * `reserve` in this module is for), but `reserveAtomic` below performs the
 * cap check and increment in one conditional upsert. PostgreSQL locks a
 * conflicting day row before evaluating the update predicate, so separate
 * processes cannot race past the cap.
 */
export class DbBudgetStore implements BudgetStore {
  constructor(private readonly getDb: () => Db) {}

  async getUsed(day: string): Promise<number> {
    const db = this.getDb();
    const rows = await db.select().from(runBudget).where(eq(runBudget.day, day));
    return rows[0]?.tokensUsed ?? 0;
  }

  async addUsage(day: string, tokens: number): Promise<void> {
    const db = this.getDb();
    await db
      .insert(runBudget)
      .values({ id: day, day, tokensUsed: tokens, tokensCap: 0 })
      .onConflictDoUpdate({
        target: runBudget.day,
        set: { tokensUsed: sql`${runBudget.tokensUsed} + ${tokens}` },
      });
  }

  /** Atomic reserve implemented as one INSERT ... ON CONFLICT DO UPDATE. */
  async reserveAtomic(day: string, requested: number, dailyCap: number): Promise<ReserveResult> {
    if (requested > dailyCap) {
      const used = await this.getUsed(day);
      return { granted: false, remaining: Math.max(0, dailyCap - used) };
    }

    const db = this.getDb();
    const rows = await db
      .insert(runBudget)
      .values({ id: day, day, tokensUsed: requested, tokensCap: dailyCap })
      .onConflictDoUpdate({
        target: runBudget.day,
        set: {
          tokensUsed: sql`${runBudget.tokensUsed} + ${requested}`,
          tokensCap: dailyCap,
        },
        setWhere: sql`${runBudget.tokensUsed} + ${requested} <= ${dailyCap}`,
      })
      .returning();

    const committed = rows[0];
    if (committed) {
      return { granted: true, remaining: dailyCap - committed.tokensUsed };
    }

    const used = await this.getUsed(day);
    return { granted: false, remaining: Math.max(0, dailyCap - used) };
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
 * dailyCap`, otherwise denies and commits nothing.
 *
 * When `store` implements `reserveAtomic` (e.g. `DbBudgetStore`), that's
 * used directly — the conditional upsert is the source of atomicity across
 * multiple processes/instances. Otherwise falls back to this
 * module's in-process `runExclusive` serialization over plain
 * `getUsed`/`addUsage`, which is sufficient for a single-process store like
 * `InMemoryBudgetStore`.
 */
export async function reserve(
  store: BudgetStore,
  day: string,
  requested: number,
  dailyCap: number,
): Promise<ReserveResult> {
  if (store.reserveAtomic) {
    return store.reserveAtomic(day, requested, dailyCap);
  }
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
