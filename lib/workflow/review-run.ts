/** App-owned draft execution: short transactions claim/persist; model calls run outside locks. */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import type { Db } from "../db/client";
import { auditEvents, initiatives, intakeVersions, reviewCycles, reviewDecisions, riskAssessments } from "../db/schema";
import type { Actor, Domain } from "../domain/types";
import { getAgentPort } from "../agents";
import type { AgentPort, DraftReviewOutput, IntakeSnapshot, InvokeOptions, PortFailure, PortResult } from "../agents/ports";
import { reviewDraftToken, reviewSnapshotCondition } from "./review-draft-token";

type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;
type Decision = typeof reviewDecisions.$inferSelect;
type SkipReason = "already signed" | "review changed" | "cycle closed" | "superseded";
export interface DraftRunDomainOutcome {
  domain: Domain;
  status: "drafted" | "failed" | "skipped";
  error?: PortFailure;
  reason?: SkipReason;
}
export interface StartDraftRunResult { runId: string; cycleId: string; outcomes: DraftRunDomainOutcome[] }
export type DraftRunDomainStatus = "pending" | "drafted" | "signed" | "returned" | "failed";
export interface DraftRunProgressRow { domain: Domain; status: DraftRunDomainStatus; lastError?: string }
export interface DraftRunProgress { cycleId: string; rows: DraftRunProgressRow[]; complete: boolean }
export interface StartDraftRunOptions extends InvokeOptions { concurrency?: number; maxAttempts?: number }
export interface RunSingleDomainOptions extends InvokeOptions { maxAttempts?: number; actor?: Actor }
export interface RunSingleDomainResult {
  cycleId: string;
  domain: Domain;
  status: "drafted" | "failed" | "skipped";
  draftMd?: string;
  error?: string;
  reason?: SkipReason;
}
const DEFAULT_TIMEOUT_MS = 30_000;

export class DraftRunConflictError extends Error {
  constructor(message: string) { super(message); this.name = "DraftRunConflictError"; }
}

async function runWithConcurrencyLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(limit), items.length || 1)) }, worker));
  return results;
}

function isRetryableFailure(error: PortFailure): boolean {
  return error.kind === "provider" && error.retryable;
}
async function draftWithRetry(port: AgentPort, cycleId: string, domain: Domain, intake: IntakeSnapshot, options: RunSingleDomainOptions): Promise<PortResult<DraftReviewOutput>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastError: PortFailure = { kind: "provider", message: "Draft failed", retryable: false };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) return { ok: false, error: { kind: "cancelled", reason: "Draft cancelled" } };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, error: { kind: "timeout", message: "Draft deadline exceeded", elapsedMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS } };
    try {
      const result = await port.draftReview({ reviewCycleId: cycleId, domain, intake }, {
        signal: options.signal, timeoutMs: remaining, onProgress: options.onProgress,
      });
      if (options.signal?.aborted) return { ok: false, error: { kind: "cancelled", reason: "Draft cancelled" } };
      if (result.ok) return result;
      lastError = result.error;
    } catch {
      lastError = { kind: "provider", message: "Review agent failed. Try again.", retryable: true };
    }
    if (!isRetryableFailure(lastError)) break;
  }
  return { ok: false, error: lastError };
}

/** Same parent-row lock as sign/return/decide, always acquired before review rows. */
async function lockCycle(tx: Tx, cycleId: string) {
  const [reference] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  if (!reference) throw new Error(`no review cycle ${cycleId}`);
  await tx.select({ id: initiatives.id }).from(initiatives).where(eq(initiatives.id, reference.initiativeId)).for("update");
  const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  return cycle!;
}

/** Count only actions that invalidate an in-flight draft, not stale workers' completion receipts. */
async function claimVersion(tx: Tx, cycleId: string, domain: Domain): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(auditEvents).where(and(
    inArray(auditEvents.action, ["review_draft_started", "review_signed", "review_returned"]),
    sql`${auditEvents.metadata}->>'cycleId' = ${cycleId}`,
    sql`${auditEvents.metadata}->>'domain' = ${domain}`,
  ));
  return Number(row!.value);
}
interface DraftClaim { decision: Decision; intake: IntakeSnapshot; initiativeId: string; version: number; attemptId: string }
async function claimDraft(db: Db, cycleId: string, domain: Domain, force: boolean, actor?: Actor): Promise<DraftClaim | null> {
  return db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.closedAt) throw new DraftRunConflictError(`review cycle ${cycleId} is closed`);
    const [assessment] = await tx.select().from(riskAssessments).where(and(eq(riskAssessments.id, cycle.riskAssessmentId), eq(riskAssessments.initiativeId, cycle.initiativeId)));
    if (!assessment || !assessment.requiredDomains.includes(domain)) throw new Error(`domain ${domain} is not required for review cycle ${cycleId}`);
    const [intake] = await tx.select().from(intakeVersions).where(and(eq(intakeVersions.id, assessment.intakeVersionId), eq(intakeVersions.initiativeId, cycle.initiativeId)));
    if (!intake) throw new Error(`review cycle ${cycleId} has no bound intake version`);
    await tx.insert(reviewDecisions).values({ id: `rd-${randomUUID()}`, cycleId, domain, status: "pending", citations: [], createdAt: new Date() }).onConflictDoNothing();
    const [decision] = await tx.select().from(reviewDecisions).where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
    if (decision!.status === "signed") {
      if (force) throw new DraftRunConflictError(`cannot re-draft a signed review (${cycleId}/${domain})`);
      return null;
    }
    if (!force && decision!.status !== "pending" && decision!.status !== "failed") return null;
    const attemptId = `attempt-${randomUUID()}`;
    await tx.insert(auditEvents).values({
      id: `evt-${randomUUID()}`, initiativeId: cycle.initiativeId, ts: new Date(),
      actor: actor?.id ?? "system", actorRole: actor?.role ?? "system", action: "review_draft_started",
      detail: `Started ${domain} review draft.`, before: decision!.status, after: decision!.status,
      metadata: { cycleId, domain, attemptId, intakeVersionId: intake.id },
    });
    return { decision: decision!, intake: { initiativeId: cycle.initiativeId, intakeVersionId: intake.id, answers: intake.fields }, initiativeId: cycle.initiativeId, version: await claimVersion(tx, cycleId, domain), attemptId };
  });
}
function describePortFailure(error: PortFailure): string {
  return error.kind === "cancelled" ? `cancelled${error.reason ? `: ${error.reason}` : ""}` : error.message;
}

/** The result and its attribution receipt commit together, including when receipt insertion fails. */
async function finishDraft(
  db: Db,
  claim: DraftClaim,
  result: PortResult<DraftReviewOutput>,
  actor?: Actor,
): Promise<RunSingleDomainResult> {
  const { cycleId } = claim.decision;
  const domain = claim.decision.domain as Domain;
  return db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    const [current] = await tx.select().from(reviewDecisions).where(eq(reviewDecisions.id, claim.decision.id));
    let reason: SkipReason | undefined;
    if (cycle.closedAt) reason = "cycle closed";
    else if (current?.status === "signed") reason = "already signed";
    else if (!current || reviewDraftToken(current) !== reviewDraftToken(claim.decision)) reason = "review changed";
    else if (await claimVersion(tx, cycleId, domain) !== claim.version) reason = "superseded";

    let outcome: RunSingleDomainResult;
    let afterStatus = current?.status ?? null;
    if (reason) {
      outcome = { cycleId, domain, status: "skipped", reason };
    } else if (!result.ok && (current!.status === "drafted" || current!.status === "returned")) {
      // A failed explicit retry cannot erase a valid draft or a human return.
      // Its error belongs to this attempt's receipt and response.
      outcome = { cycleId, domain, status: "failed", error: describePortFailure(result.error) };
    } else {
      const values = result.ok
        ? {
            status: "drafted", draftMd: result.value.draftMarkdown,
            citations: [...result.value.citations], returnReason: null,
            reviewer: null, signedAt: null,
          }
        : { status: "pending", returnReason: `draft failed: ${describePortFailure(result.error)}` };
      const updated = await tx.update(reviewDecisions).set(values)
        .where(reviewSnapshotCondition(claim.decision)).returning();
      if (updated.length === 0) {
        outcome = { cycleId, domain, status: "skipped", reason: "review changed" };
      } else {
        afterStatus = updated[0]!.status;
        outcome = result.ok
          ? { cycleId, domain, status: "drafted", draftMd: result.value.draftMarkdown }
          : { cycleId, domain, status: "failed", error: describePortFailure(result.error) };
      }
    }
    await tx.insert(auditEvents).values({
      id: `evt-${randomUUID()}`,
      initiativeId: claim.initiativeId,
      ts: new Date(),
      actor: actor?.id ?? "system",
      actorRole: actor?.role ?? "system",
      action: actor ? "review_agent_run" : "review_draft_completed",
      detail: `Ran the ${domain} review agent: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}.`,
      before: current?.status ?? null,
      after: afterStatus,
      metadata: {
        cycleId, domain, attemptId: claim.attemptId, status: outcome.status,
        intakeVersionId: claim.intake.intakeVersionId,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(!result.ok ? { errorKind: result.error.kind } : {}),
      },
    });
    return outcome;
  });
}

export async function runSingleDomainDraft(db: Db, cycleId: string, domain: Domain, port: AgentPort = getAgentPort(), options: RunSingleDomainOptions = {}): Promise<RunSingleDomainResult> {
  const claim = await claimDraft(db, cycleId, domain, true, options.actor);
  if (!claim) return { cycleId, domain, status: "skipped" };
  const result = await draftWithRetry(port, cycleId, domain, claim.intake, options);
  return finishDraft(db, claim, result, options.actor);
}

/** Resume only unfinished domains; duplicate request entries never consume extra calls. */
export async function startDraftRun(db: Db, initiativeId: string, domains: Domain[], port: AgentPort = getAgentPort(), options: StartDraftRunOptions = {}): Promise<StartDraftRunResult> {
  const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, initiativeId)).orderBy(desc(reviewCycles.openedAt), desc(reviewCycles.id)).limit(1);
  if (!cycle) throw new Error(`startDraftRun: initiative ${initiativeId} has no review cycle`);
  if (cycle.closedAt) throw new DraftRunConflictError(`review cycle ${cycle.id} is closed`);
  const runId = `run-${randomUUID()}`;
  const outcomes = await runWithConcurrencyLimit([...new Set(domains)], options.concurrency ?? 3, async (domain): Promise<DraftRunDomainOutcome> => {
    const claim = await claimDraft(db, cycle.id, domain, false);
    if (!claim) return { domain, status: "skipped" };
    const result = await draftWithRetry(port, cycle.id, domain, claim.intake, options);
    const persisted = await finishDraft(db, claim, result);
    return { domain, status: persisted.status, ...(persisted.reason ? { reason: persisted.reason } : {}), ...(!result.ok && persisted.status === "failed" ? { error: result.error } : {}) };
  });
  await db.insert(auditEvents).values({
    id: `evt-${randomUUID()}`, initiativeId, ts: new Date(), actor: "system", actorRole: "system", action: "draft_run_completed",
    detail: `Draft run ${runId} for cycle ${cycle.id}: ${outcomes.filter((o) => o.status === "drafted").length} drafted, ${outcomes.filter((o) => o.status === "failed").length} failed, ${outcomes.filter((o) => o.status === "skipped").length} skipped.`,
    before: null, after: null, metadata: { runId, outcomes },
  });
  return { runId, cycleId: cycle.id, outcomes };
}

export async function getRunProgress(db: Db, cycleId: string): Promise<DraftRunProgress> {
  const rows = await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId, cycleId));
  const progressRows = rows.sort((a, b) => a.domain.localeCompare(b.domain)).map((r) => ({ domain: r.domain as Domain, status: r.status as DraftRunDomainStatus, ...(r.returnReason && r.status === "pending" ? { lastError: r.returnReason } : {}) }));
  return { cycleId, rows: progressRows, complete: progressRows.every((r) => r.status === "drafted" || r.status === "signed" || r.status === "returned") };
}
