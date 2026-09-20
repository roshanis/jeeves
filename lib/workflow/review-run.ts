/** Application-owned draft execution: short locked claims and atomic result receipts. */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, reviewCycles, reviewDecisions, runBudget } from "../db/schema";
import type { Actor, Domain } from "../domain/types";
import { getAgentPort } from "../agents";
import type { AgentPort, DraftReviewOutput, PortFailure, PortResult } from "../agents/ports";
import { lockCurrentReviewCycle, ReviewIntegrityError, type ReviewTx } from "../services/review-integrity";
import { loadReviewContext } from "./review-context";
import type { DraftBudgetPolicy } from "./draft-execution-policy";

export type SkipReason = "already signed" | "already running" | "superseded";
export interface DraftRunDomainOutcome { domain: Domain; status: "drafted" | "failed" | "skipped"; error?: PortFailure; reason?: SkipReason }
export interface StartDraftRunResult { runId: string; cycleId: string; outcomes: DraftRunDomainOutcome[] }
export type DraftRunDomainStatus = "pending" | "drafted" | "signed" | "returned" | "failed";
export interface DraftRunProgressRow { domain: Domain; status: DraftRunDomainStatus; lastError?: string }
export interface DraftRunProgress { cycleId: string; rows: DraftRunProgressRow[]; complete: boolean }
export interface StartDraftRunOptions {
  concurrency?: number;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  runTimeoutMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  actor?: Actor;
  sessionWorkspaceId?: string | null;
  expectedRevision?: number;
  budget?: DraftBudgetPolicy;
}
export type RunSingleDomainOptions = StartDraftRunOptions;
export interface RunSingleDomainResult { cycleId: string; domain: Domain; status: "drafted" | "failed" | "skipped"; draftMd?: string; revision?: number; error?: string; errorKind?: PortFailure["kind"]; reason?: SkipReason }

type ReviewRow = typeof reviewDecisions.$inferSelect;
type Claim = { id: string; row: ReviewRow; initiativeId: string; context: Awaited<ReturnType<typeof loadReviewContext>> };
type DraftResult = PortResult<DraftReviewOutput>;
const system: Actor = { id: "system", role: "system" };
const timeout = (elapsedMs: number): PortFailure => ({ kind: "timeout", message: "Draft generation exceeded its time limit. Retry this domain.", elapsedMs });
const cancelled = (): PortFailure => ({ kind: "cancelled", reason: "Draft generation was cancelled." });
function failureText(error: PortFailure) { return error.kind === "cancelled" ? error.reason ?? "cancelled" : error.message; }
function retryable(error: PortFailure) { return error.kind === "timeout" || (error.kind === "provider" && error.retryable); }
function bounded(value: number | undefined, fallback: number, maximum: number) { return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value!), maximum)) : fallback; }
async function databaseNow(tx: ReviewTx): Promise<Date> {
  const result = await tx.execute(sql`select clock_timestamp() as now`) as { rows: {now: Date | string}[] } | {now: Date | string}[];
  const rows = (Array.isArray(result) ? result : result.rows) as {now: Date | string}[];
  return new Date(rows[0]!.now);
}
async function receipt(tx: ReviewTx, claim: Claim, options: StartDraftRunOptions, action: string, after: string, metadata: Record<string, unknown>) {
  const actor = options.actor ?? system;
  await tx.insert(auditEvents).values({ id: `evt-${randomUUID()}`, initiativeId: claim.initiativeId, ts: new Date(), actor: actor.id, actorRole: actor.role, action,
    detail: `${claim.row.domain} draft attempt ${claim.id}: ${after}.`, before: claim.row.status, after,
    metadata: { cycleId: claim.row.cycleId, domain: claim.row.domain, attemptId: claim.id, ...metadata } });
}
async function claimDomain(db: Db, cycleId: string, domain: Domain, force: boolean, options: StartDraftRunOptions, deadline: number): Promise<Claim | DraftRunDomainOutcome> {
  return db.transaction(async (tx) => {
    const { initiative } = await lockCurrentReviewCycle(tx, cycleId, options.sessionWorkspaceId);
    let [row] = await tx.select().from(reviewDecisions).where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
    if (!row) {
      if (force) throw new ReviewIntegrityError("not_found", "Review decision not found.");
      [row] = await tx.insert(reviewDecisions).values({ id: `rd-${randomUUID()}`, cycleId, domain, status: "pending", createdAt: new Date(), citations: [] }).returning();
    }
    if (options.expectedRevision !== undefined && row.revision !== options.expectedRevision) throw new ReviewIntegrityError("conflict", "This draft changed. Refresh and review the current version.");
    if (row.status === "signed") {
      if (force) throw new ReviewIntegrityError("conflict", "Cannot re-draft a signed review.");
      return { domain, status: "skipped", reason: "already signed" };
    }
    if (!force && !["pending", "failed"].includes(row.status)) return { domain, status: "skipped" };
    const now = await databaseNow(tx);
    if (row.activeAttemptId && row.activeAttemptExpiresAt && row.activeAttemptExpiresAt > now) return { domain, status: "skipped", reason: "already running" };
    // Capture the immutable source versions while the same initiative lock protects evidence changes.
    const context = await loadReviewContext(tx, cycleId, domain);
    const id = `attempt-${randomUUID()}`;
    await tx.update(reviewDecisions).set({ activeAttemptId: id, activeAttemptExpiresAt: new Date(now.getTime() + Math.max(0, deadline - Date.now()) + 5000) }).where(eq(reviewDecisions.id, row.id));
    const claim = { id, row, initiativeId: initiative.id, context };
    await receipt(tx, claim, options, "draft_attempt_started", row.status, { revision: row.revision, sourceMetadata: context.metadata });
    return claim;
  });
}
class ReservationInterrupted extends Error {
  constructor(readonly reason: "cancelled" | "timed-out") { super(reason); }
}
async function reserveAttempt(db: Db, claim: Claim, options: StartDraftRunOptions, attempt: number, deadline: number): Promise<"ready" | "superseded" | "budget-exhausted" | "cancelled" | "timed-out"> {
  const requireTime = () => {
    if (options.signal?.aborted) throw new ReservationInterrupted("cancelled");
    if (Date.now() >= deadline) throw new ReservationInterrupted("timed-out");
  };
  try { return await db.transaction(async (tx) => {
    try { await lockCurrentReviewCycle(tx, claim.row.cycleId, options.sessionWorkspaceId); }
    catch (error) { if (error instanceof ReviewIntegrityError && error.kind === "conflict") return "superseded"; throw error; }
    const [row] = await tx.select().from(reviewDecisions).where(eq(reviewDecisions.id, claim.row.id));
    const now = await databaseNow(tx);
    if (!row || row.activeAttemptId !== claim.id || row.revision !== claim.row.revision || !row.activeAttemptExpiresAt || row.activeAttemptExpiresAt <= now || row.status === "signed") return "superseded";
    requireTime();
    if (options.budget) {
      const { day, tokensPerAttempt, dailyCap } = options.budget;
      const reservationId = `evt-budget-${claim.id}-${attempt}`;
      const [existing] = await tx.select({id: auditEvents.id}).from(auditEvents).where(eq(auditEvents.id, reservationId));
      if (existing) return "ready";
      if (tokensPerAttempt > dailyCap) return "budget-exhausted";
      const reserved = await tx.insert(runBudget).values({id:day,day,tokensUsed:tokensPerAttempt,tokensCap:dailyCap}).onConflictDoUpdate({
        target: runBudget.day, set: {tokensUsed:sql`${runBudget.tokensUsed} + ${tokensPerAttempt}`,tokensCap:dailyCap},
        setWhere:sql`${runBudget.tokensUsed} + ${tokensPerAttempt} <= ${dailyCap}`,
      }).returning();
      // A shared-budget row lock may also outlast cancellation/deadline.
      // Throwing here rolls back any reservation for work never dispatched.
      requireTime();
      if (!reserved.length) return "budget-exhausted";
      const actor = options.actor ?? system;
      await tx.insert(auditEvents).values({id:reservationId,initiativeId:claim.initiativeId,ts:new Date(),actor:actor.id,actorRole:actor.role,
        action:"draft_budget_reserved",detail:"Reserved estimated model capacity for one draft attempt.",metadata:{attemptId:claim.id,attempt,estimatedTokens:tokensPerAttempt,day}});
    }
    requireTime();
    return "ready";
  }); } catch (error) {
    if (error instanceof ReservationInterrupted) return error.reason;
    throw error;
  }
}
async function invoke(port: AgentPort, claim: Claim, options: StartDraftRunOptions, timeoutMs: number): Promise<DraftResult> {
  if (options.signal?.aborted) return {ok:false,error:cancelled()};
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const stopped = new Promise<DraftResult>((resolve) => {
    abort = () => { controller.abort(); resolve({ok:false,error:cancelled()}); };
    options.signal?.addEventListener("abort", abort, {once:true});
    timer = setTimeout(() => { controller.abort(); resolve({ok:false,error:timeout(timeoutMs)}); }, timeoutMs);
  });
  const call = Promise.resolve().then(() => port.draftReview({reviewCycleId:claim.row.cycleId,domain:claim.row.domain as Domain,intake:claim.context.intake,policyContext:claim.context.policyContext},
    {signal:controller.signal,timeoutMs})).catch((): DraftResult => ({ok:false,error:{kind:"provider",message:"Draft generation failed. Retry this domain.",retryable:true}}));
  try { return await Promise.race([call,stopped]); }
  finally { if(timer)clearTimeout(timer); options.signal?.removeEventListener("abort",abort); }
}
async function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted || ms <= 0) return;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort",finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort",finish,{once:true});
  });
}
async function finish(db: Db, claim: Claim, options: StartDraftRunOptions, result: DraftResult, deadline: number): Promise<RunSingleDomainResult> {
  return db.transaction(async (tx) => {
    try { await lockCurrentReviewCycle(tx, claim.row.cycleId, options.sessionWorkspaceId); }
    catch(error) { if(error instanceof ReviewIntegrityError && error.kind === "conflict") return {cycleId:claim.row.cycleId,domain:claim.row.domain as Domain,status:"skipped",reason:"superseded"}; throw error; }
    const [current] = await tx.select().from(reviewDecisions).where(eq(reviewDecisions.id,claim.row.id));
    const now = await databaseNow(tx);
    const reason: SkipReason | null = current?.status === "signed" ? "already signed" :
      !current || current.activeAttemptId !== claim.id || current.revision !== claim.row.revision || !current.activeAttemptExpiresAt || current.activeAttemptExpiresAt <= now ? "superseded" : null;
    if(reason) return {cycleId:claim.row.cycleId,domain:claim.row.domain as Domain,status:"skipped",reason};
    const fresh = await loadReviewContext(tx,claim.row.cycleId,claim.row.domain as Domain);
    if(fresh.metadata.contextHash !== claim.context.metadata.contextHash) {
      await tx.update(reviewDecisions).set({activeAttemptId:null,activeAttemptExpiresAt:null}).where(eq(reviewDecisions.id,current.id));
      await receipt(tx,claim,options,"draft_attempt_superseded",current.status,{reason:"Review inputs changed."});
      return {cycleId:claim.row.cycleId,domain:claim.row.domain as Domain,status:"skipped",reason:"superseded"};
    }
    // Once cancelled, no successful result is accepted, even if provider completion raced the abort.
    const accepted: DraftResult = options.signal?.aborted ? {ok:false,error:cancelled()} :
      Date.now() >= deadline ? {ok:false,error:timeout(bounded(options.runTimeoutMs,90_000,180_000))} : result;
    const revision = current.revision+1;
    const common = {revision,activeAttemptId:null,activeAttemptExpiresAt:null};
    if(accepted.ok) {
      const value = accepted.value;
      await tx.update(reviewDecisions).set({...common,status:"drafted",draftMd:value.draftMarkdown,citations:[...(value.citations??[])],missingEvidence:[...value.missingEvidence],
        evidenceRequests:[...(value.evidenceRequests??[])],citationProvenance:"agent-supplied",returnReason:null,signatureEventId:null,signedAt:null,
        sourceMetadata:{...claim.context.metadata,...(value.generationMetadata?{generation:value.generationMetadata}:{}),attemptId:claim.id}}).where(eq(reviewDecisions.id,current.id));
    } else {
      // Failed re-drafting does not erase an existing human-visible assessment or return.
      await tx.update(reviewDecisions).set({...common,returnReason:current.status === "returned" ? current.returnReason : `draft failed: ${failureText(accepted.error)}`}).where(eq(reviewDecisions.id,current.id));
    }
    const outcome = accepted.ok ? "drafted" : "failed";
    await receipt(tx,claim,options,options.actor?.role === "reviewer" ? "review_agent_run" : "draft_domain_completed",accepted.ok?"drafted":current.status,
      {status:outcome,revision,sourceMetadata:claim.context.metadata,...(!accepted.ok?{errorKind:accepted.error.kind}:{})});
    return {cycleId:claim.row.cycleId,domain:claim.row.domain as Domain,status:outcome,revision,...(accepted.ok?{draftMd:accepted.value.draftMarkdown}:{error:failureText(accepted.error),errorKind:accepted.error.kind})};
  });
}
function acceptedOutcome(outcome: RunSingleDomainResult, result: DraftResult, options: StartDraftRunOptions): {outcome: RunSingleDomainResult; failure?: PortFailure} {
  if (outcome.status !== "failed") return {outcome};
  // Final persistence can reject a provider success after cancellation or a
  // database wait. Report that accepted failure, not the earlier provider result.
  if (!result.ok && result.error.kind === outcome.errorKind) return {outcome, failure: result.error};
  return {outcome, failure: outcome.errorKind === "cancelled" ? cancelled() : timeout(bounded(options.runTimeoutMs,90_000,180_000))};
}
async function execute(db: Db, claim: Claim, port: AgentPort | undefined, options: StartDraftRunOptions, deadline: number): Promise<{outcome:RunSingleDomainResult; failure?:PortFailure}> {
  let result: DraftResult = {ok:false,error:timeout(0)};
  const attempts = bounded(options.maxAttempts,2,3);
  let agent: AgentPort;
  try { agent = port ?? getAgentPort(); }
  catch { result = {ok:false,error:{kind:"provider",message:"The agent runtime is unavailable. Contact the demo operator.",retryable:false}}; return acceptedOutcome(await finish(db,claim,options,result,deadline),result,options); }
  for(let attempt=1;attempt<=attempts;attempt++) {
    if(options.signal?.aborted) { result={ok:false,error:cancelled()}; break; }
    const remaining=deadline-Date.now();
    if(remaining<=0){result={ok:false,error:timeout(bounded(options.runTimeoutMs,90_000,180_000))};break;}
    const reserved=await reserveAttempt(db,claim,options,attempt,deadline);
    if(reserved==="superseded")return {outcome:{cycleId:claim.row.cycleId,domain:claim.row.domain as Domain,status:"skipped",reason:"superseded"}};
    if(reserved==="cancelled"){result={ok:false,error:cancelled()};break;}
    if(reserved==="timed-out"){result={ok:false,error:timeout(bounded(options.runTimeoutMs,90_000,180_000))};break;}
    if(reserved==="budget-exhausted"){result={ok:false,error:{kind:"budget-exhausted",message:"Demo token reservation budget exhausted for today."}};break;}
    // Lock acquisition and reservation can consume the remaining run time.
    const dispatchRemaining = deadline-Date.now();
    if (dispatchRemaining<=0) {result={ok:false,error:timeout(bounded(options.runTimeoutMs,90_000,180_000))};break;}
    if (options.signal?.aborted) {result={ok:false,error:cancelled()};break;}
    result=await invoke(agent,claim,options,Math.min(dispatchRemaining,bounded(options.attemptTimeoutMs,30_000,90_000)));
    if(result.ok || !retryable(result.error) || attempt===attempts)break;
    const base=options.retryDelayMs===0?0:bounded(options.retryDelayMs,250,2000);
    await delay(Math.min(Math.max(0,deadline-Date.now()),base*2**(attempt-1)*(0.75+Math.random()*0.5)),options.signal);
  }
  return acceptedOutcome(await finish(db,claim,options,result,deadline),result,options);
}

export async function startDraftRun(db:Db,initiativeId:string,domains:Domain[],port?:AgentPort,options:StartDraftRunOptions={}):Promise<StartDraftRunResult> {
  const [cycle]=await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId,initiativeId)).orderBy(desc(reviewCycles.openedAt),desc(reviewCycles.id)).limit(1);
  if(!cycle)throw new ReviewIntegrityError("not_found","Review cycle not found.");
  const runId=`run-${randomUUID()}`, unique=[...new Set(domains)], outcomes:DraftRunDomainOutcome[]=new Array(unique.length);
  const deadline=Date.now()+bounded(options.runTimeoutMs,90_000,180_000);
  let cursor=0;
  const errors:unknown[]=[];
  async function worker(){
    while(cursor<unique.length){const index=cursor++;const domain=unique[index]!;
      try{
        const claim=await claimDomain(db,cycle.id,domain,false,options,deadline);
        if("status" in claim){outcomes[index]=claim;continue;}
        const {outcome,failure}=await execute(db,claim,port,options,deadline);
        outcomes[index]={domain,status:outcome.status,...(outcome.reason?{reason:outcome.reason}:{}),...(failure?{error:failure}:{})};
      }catch(error){errors.push(error);}
    }
  }
  // Drain siblings before responding; a failure cannot leave hidden commits racing the response.
  await Promise.all(Array.from({length:Math.min(unique.length,bounded(options.concurrency,3,8))},worker));
  if(errors.length)throw errors[0];
  return {runId,cycleId:cycle.id,outcomes};
}
export async function runSingleDomainDraft(db:Db,cycleId:string,domain:Domain,port?:AgentPort,options:RunSingleDomainOptions={}):Promise<RunSingleDomainResult> {
  const deadline=Date.now()+bounded(options.runTimeoutMs,90_000,180_000);
  const claim=await claimDomain(db,cycleId,domain,true,options,deadline);
  if("status" in claim)return {cycleId,domain,status:claim.status,reason:claim.reason};
  return (await execute(db,claim,port,options,deadline)).outcome;
}
export async function getRunProgress(db:Db,cycleId:string):Promise<DraftRunProgress>{
  const rows=await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId,cycleId));
  const progressRows:DraftRunProgressRow[]=rows.sort((a,b)=>a.domain.localeCompare(b.domain)).map(r=>({domain:r.domain as Domain,status:r.status as DraftRunDomainStatus,
    ...(r.returnReason&&r.status==="pending"?{lastError:r.returnReason}:{})}));
  return {cycleId,rows:progressRows,complete:progressRows.length>0&&progressRows.every(r=>["drafted","signed","returned"].includes(r.status))};
}
