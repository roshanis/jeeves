/**
 * WorkflowPort-shaped fan-out for domain draft reviews (plan.md §2 step 2,
 * §9 P2; task brief deliverable 2).
 *
 * `startDraftRun` invokes `getAgentPort().draftReview` once PER requested
 * domain, CONCURRENTLY (`Promise.allSettled` — one rejected/slow domain
 * never blocks the others), and persists each result into `review_decisions`
 * as it completes. State lives entirely in Postgres (`review_decisions` +
 * a lightweight `run_progress` audit-event trail) — "durable-lite": there is
 * no in-memory run registry, so a caller can re-invoke `startDraftRun` for
 * the same cycle at any time (e.g. after a server restart) and it resumes
 * by re-attempting only domains that are not already `drafted`/`signed`.
 *
 * Idempotency: `review_decisions` has a unique (cycleId, domain) constraint
 * (lib/db/schema.ts). This module never inserts a second row for a
 * (cycle, domain) pair that already exists — it always updates the
 * existing `pending`/`returned` row in place, so re-running the same fan-out
 * twice never duplicates rows (task brief: "idempotent per (cycle, domain)").
 * A domain already `drafted` or `signed` is left untouched by a re-run
 * (no wasted LLM calls, no clobbering a human-signed decision).
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

function nowTs(): number {
  return Date.now();
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
 * Every remaining domain is drafted concurrently via
 * `Promise.allSettled` — a rejected/failed promise for one domain never
 * prevents the others from completing and being persisted.
 */
export async function startDraftRun(
  db: Db,
  initiativeId: string,
  domains: Domain[],
  /** Overridable for tests (inject a failing/fake AgentPort); defaults to the real `getAgentPort()`. */
  port: AgentPort = getAgentPort(),
): Promise<StartDraftRunResult> {
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

  const settled = await Promise.allSettled(
    toRun.map(async (domain) => {
      const result = await port.draftReview({
        reviewCycleId: cycleId,
        domain: domain as GovernanceDomain,
        intake,
      });
      return { domain, result };
    }),
  );

  const outcomes: DraftRunDomainOutcome[] = [...alreadyDone];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const domain = toRun[i]!;

    if (outcome.status === "rejected") {
      await persistFailure(db, cycleId, domain, {
        kind: "provider",
        message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        retryable: true,
      });
      outcomes.push({
        domain,
        status: "failed",
        error: {
          kind: "provider",
          message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          retryable: true,
        },
      });
      continue;
    }

    const { result } = outcome.value;
    if (!result.ok) {
      await persistFailure(db, cycleId, domain, result.error);
      outcomes.push({ domain, status: "failed", error: result.error });
      continue;
    }

    await persistDraft(db, cycleId, domain, result.value);
    outcomes.push({ domain, status: "drafted" });
  }

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
