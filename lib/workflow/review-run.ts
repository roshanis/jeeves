/**
 * WorkflowPort-shaped fan-out for domain draft reviews (plan.md §2 step 2,
 * §9 P2; task brief deliverable 2).
 *
 * `startDraftRun` invokes `getAgentPort().draftReview` once PER requested
 * domain and persists each result into `review_decisions` as it completes.
 * State lives entirely in Postgres (`review_decisions` + a lightweight
 * `run_progress` audit-event trail) — "durable-lite": there is no in-memory
 * run registry, so a caller can re-invoke `startDraftRun` for the same cycle
 * at any time (e.g. after a server restart) and it resumes by re-attempting
 * only domains that are not already `drafted`/`signed`.
 *
 * Idempotency: `review_decisions` has a unique (cycleId, domain) constraint
 * (lib/db/schema.ts). This module never inserts a second row for a
 * (cycle, domain) pair that already exists — it always updates the
 * existing `pending`/`returned` row in place, so re-running the same fan-out
 * twice never duplicates rows (task brief: "idempotent per (cycle, domain)").
 * A domain already `drafted` or `signed` is left untouched by a re-run
 * (no wasted LLM calls, no clobbering a human-signed decision).
 *
 * Bounded concurrency (hardening pass, Codex review): rather than firing all
 * requested domains at once via a single `Promise.allSettled` (up to 8
 * concurrent LLM calls per HTTP request — a real risk for provider
 * concurrency limits / request timeouts), domains are run through a small
 * hand-rolled worker-pool limiter (`runWithConcurrencyLimit` below) that
 * caps in-flight `draftReview` calls at `options.concurrency` (default 3).
 * Workers pull the next domain off a shared queue as soon as they finish, so
 * this preserves the exact same order-independent semantics as before: every
 * requested-and-eligible domain is still attempted, and one slow/failed
 * domain in one batch never blocks domains assigned to other workers.
 *
 * Per-domain retry (hardening pass): a domain whose `draftReview` attempt
 * fails (thrown rejection or `{ ok: false }` PortResult) is retried, up to
 * `options.maxAttempts` total attempts (default 2 — i.e. one retry), before
 * being persisted/recorded as `failed`. `PortFailure` (lib/agents/ports.ts)
 * has no reliable cross-variant transient/permanent discriminator — only the
 * `provider` variant carries a `retryable` boolean, `validation` is clearly
 * permanent (bad input will fail identically every time), and `cancelled`
 * represents a deliberate abort that retrying would defeat. Rather than
 * inventing a discriminator that doesn't exist on the type, this module
 * retries every failure kind EXCEPT `validation` and `cancelled`, and additionally
 * skips retrying a `provider` failure whose `retryable` is explicitly `false`.
 * This is a conservative, documented choice, not a guess: worst case for an
 * unretryable-but-not-explicitly-marked failure is one extra (cheap, bounded)
 * attempt, never an infinite loop, and it never retries a deliberate
 * cancellation or a request that will provably fail the same way again.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, intakeVersions, reviewCycles, reviewDecisions } from "../db/schema";
import type { Domain } from "../domain/types";
import { getAgentPort } from "../agents";
import type {
  AgentPort,
  DraftReviewOutput,
  GovernanceDomain,
  IntakeSnapshot,
  PortFailure,
} from "../agents/ports";

export interface DraftRunDomainOutcome {
  domain: Domain;
  status: "drafted" | "failed" | "skipped";
  /** Present when status === "failed". */
  error?: PortFailure;
}

export interface StartDraftRunResult {
  runId: string;
  cycleId: string;
  outcomes: DraftRunDomainOutcome[];
}

export type DraftRunDomainStatus = "pending" | "drafted" | "signed" | "returned" | "failed";

export interface DraftRunProgressRow {
  domain: Domain;
  status: DraftRunDomainStatus;
  /** Present only for domains whose most recent attempt failed. */
  lastError?: string;
}

export interface DraftRunProgress {
  cycleId: string;
  rows: DraftRunProgressRow[];
  /** True once every requested domain is drafted/signed/returned (none pending/failed). */
  complete: boolean;
}

/** Options accepted by `startDraftRun`, all optional with documented defaults. */
export interface StartDraftRunOptions {
  /** Max concurrent `draftReview` calls in flight at once. Default 3. */
  concurrency?: number;
  /** Max attempts per domain (first try + retries) before recording `failed`. Default 2. */
  maxAttempts?: number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_ATTEMPTS = 2;

function nowTs(): number {
  return Date.now();
}

/**
 * Runs `task` for every item in `items` with at most `limit` invocations
 * in flight concurrently, returning results in the SAME order as `items`
 * (order of the returned array is stable and input-indexed even though
 * completion order is not — callers zip `items[i]` with `results[i]`).
 * Implemented as a small worker pool: `limit` workers pull the next index
 * off a shared cursor as soon as they finish their current item, so a
 * slow/failed item never blocks items assigned to other workers, and every
 * item is still attempted exactly once per call (retries are the caller's
 * concern inside `task`, not this helper's).
 */
async function runWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  task: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  let cursor = 0;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}

/**
 * True when a failed `draftReview` attempt is worth retrying. See the
 * top-of-file comment for the reasoning: retry every kind except a
 * deliberate `cancelled` abort, a permanently-invalid `validation` failure,
 * or a `provider` failure explicitly marked non-retryable.
 */
function isRetryableFailure(error: PortFailure): boolean {
  if (error.kind === "cancelled" || error.kind === "validation") return false;
  if (error.kind === "provider" && !error.retryable) return false;
  return true;
}

/**
 * Attempts `port.draftReview` for one domain up to `maxAttempts` times,
 * retrying only on a retryable failure (see `isRetryableFailure`). Returns
 * the last attempt's outcome (success, or the final failure) — the caller
 * persists exactly one row per domain regardless of how many attempts ran.
 */
async function draftWithRetry(
  port: AgentPort,
  cycleId: string,
  domain: Domain,
  intake: IntakeSnapshot,
  maxAttempts: number,
): Promise<{ ok: true; value: DraftReviewOutput } | { ok: false; error: PortFailure }> {
  let lastError: PortFailure = {
    kind: "provider",
    message: `draftReview for ${domain} never attempted (maxAttempts < 1)`,
    retryable: true,
  };

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    try {
      const result = await port.draftReview({
        reviewCycleId: cycleId,
        domain: domain as GovernanceDomain,
        intake,
      });
      if (result.ok) return result;
      lastError = result.error;
      if (!isRetryableFailure(lastError) || attempt >= maxAttempts) {
        return { ok: false, error: lastError };
      }
    } catch (err) {
      lastError = {
        kind: "provider",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
      if (attempt >= maxAttempts) {
        return { ok: false, error: lastError };
      }
    }
  }

  return { ok: false, error: lastError };
}

async function loadIntakeSnapshot(tx: Db, initiativeId: string): Promise<IntakeSnapshot> {
  const rows = await tx.select().from(intakeVersions).where(eq(intakeVersions.initiativeId, initiativeId));
  const latest = rows.slice().sort((a, b) => b.version - a.version)[0];
  if (!latest) {
    throw new Error(`startDraftRun: initiative ${initiativeId} has no intake version`);
  }
  return {
    initiativeId,
    intakeVersionId: latest.id,
    answers: latest.fields,
  };
}

/**
 * Run (or resume) a fan-out draft-review pass for `domains` against
 * `cycleId`. Skips any domain whose `review_decisions` row is already
 * `drafted`, `signed`, or `returned` (idempotent re-run / resumability).
 * Every remaining domain is drafted with retry, at most `options.concurrency`
 * at a time (default 3) — a failed/slow domain never prevents others from
 * completing and being persisted; see the top-of-file comment for the
 * bounded-concurrency and retry design.
 */
export async function startDraftRun(
  db: Db,
  initiativeId: string,
  domains: Domain[],
  /** Overridable for tests (inject a failing/fake AgentPort); defaults to the real `getAgentPort()`. */
  port: AgentPort = getAgentPort(),
  options: StartDraftRunOptions = {},
): Promise<StartDraftRunResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const cycleRows = await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, initiativeId));
  const cycle = cycleRows.slice().sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0];
  if (!cycle) {
    throw new Error(`startDraftRun: initiative ${initiativeId} has no review cycle`);
  }
  const cycleId = cycle.id;
  const runId = `run-${randomUUID()}`;

  const existingRows = await db
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.cycleId, cycleId), inArray(reviewDecisions.domain, domains)));
  const existingByDomain = new Map(existingRows.map((r) => [r.domain, r]));

  const toRun = domains.filter((d) => {
    const existing = existingByDomain.get(d);
    return !existing || existing.status === "pending" || existing.status === "failed";
  });
  const alreadyDone: DraftRunDomainOutcome[] = domains
    .filter((d) => !toRun.includes(d))
    .map((d) => ({ domain: d, status: "skipped" }));

  const intake = await loadIntakeSnapshot(db, initiativeId);

  // Bounded-concurrency, retrying fan-out (see top-of-file comment). Each
  // worker persists its own domain's result the moment its attempts settle,
  // so persistence still happens "as it completes" exactly as before — only
  // the number of simultaneously in-flight `draftReview` calls changed.
  const runResults = await runWithConcurrencyLimit(toRun, concurrency, async (domain) => {
    const result = await draftWithRetry(port, cycleId, domain, intake, maxAttempts);
    if (result.ok) {
      await persistDraft(db, cycleId, domain, result.value);
      return { domain, status: "drafted" as const };
    }
    await persistFailure(db, cycleId, domain, result.error);
    return { domain, status: "failed" as const, error: result.error };
  });

  const outcomes: DraftRunDomainOutcome[] = [...alreadyDone, ...runResults];

  await db.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(nowTs()),
    actor: "system",
    actorRole: "system",
    action: "draft_run_completed",
    detail: `Draft run ${runId} for cycle ${cycleId}: ${outcomes.filter((o) => o.status === "drafted").length} drafted, ${
      outcomes.filter((o) => o.status === "failed").length
    } failed, ${alreadyDone.length} already done.`,
    before: null,
    after: null,
    metadata: { runId, outcomes },
  });

  return { runId, cycleId, outcomes };
}

async function persistDraft(
  db: Db,
  cycleId: string,
  domain: Domain,
  value: DraftReviewOutput,
): Promise<void> {
  const rows = await db
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
  const existing = rows[0];
  const citations: string[] = [...value.missingEvidence];

  if (existing) {
    await db
      .update(reviewDecisions)
      .set({ status: "drafted", draftMd: value.draftMarkdown, citations, returnReason: null })
      .where(eq(reviewDecisions.id, existing.id));
  } else {
    await db.insert(reviewDecisions).values({
      id: `rd-${randomUUID()}`,
      cycleId,
      domain,
      status: "drafted",
      reviewer: null,
      draftMd: value.draftMarkdown,
      citations,
      signedAt: null,
      returnReason: null,
      createdAt: new Date(nowTs()),
    });
  }
}

/** Renders any `PortFailure` variant to a human-readable string ("cancelled" has no `message` field). */
function describePortFailure(error: PortFailure): string {
  if (error.kind === "cancelled") {
    return `cancelled${error.reason ? `: ${error.reason}` : ""}`;
  }
  return error.message;
}

async function persistFailure(
  db: Db,
  cycleId: string,
  domain: Domain,
  error: PortFailure,
): Promise<void> {
  const rows = await db
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
  const existing = rows[0];

  // Per-domain failure isolation: leave the row 'pending' (not 'drafted'),
  // recording the failure reason in returnReason so the UI can surface it,
  // without blocking retry (a subsequent startDraftRun re-attempts it since
  // it is still not drafted/signed/returned).
  const reasonText = `draft failed: ${describePortFailure(error)}`;

  if (existing) {
    await db
      .update(reviewDecisions)
      .set({ status: "pending", returnReason: reasonText })
      .where(eq(reviewDecisions.id, existing.id));
  } else {
    await db.insert(reviewDecisions).values({
      id: `rd-${randomUUID()}`,
      cycleId,
      domain,
      status: "pending",
      reviewer: null,
      draftMd: null,
      citations: [],
      signedAt: null,
      returnReason: reasonText,
      createdAt: new Date(nowTs()),
    });
  }
}

/** UI polling endpoint support (task brief: `getRunProgress(cycleId)`). */
export async function getRunProgress(db: Db, cycleId: string): Promise<DraftRunProgress> {
  const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
  const progressRows: DraftRunProgressRow[] = rows
    .slice()
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((r) => ({
      domain: r.domain as Domain,
      status: r.status as DraftRunDomainStatus,
      ...(r.returnReason && r.status === "pending" ? { lastError: r.returnReason } : {}),
    }));
  const complete = progressRows.every((r) => r.status === "drafted" || r.status === "signed" || r.status === "returned");
  return { cycleId, rows: progressRows, complete };
}
