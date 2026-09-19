# Workflow continuity: no silently abandoned work

Status: proposal for human GO, not implemented. Source baseline: locally cached `origin/main` `8c7c0a0`, inspected 2026-09-19. No remote refresh or deployed behavior verification. Preserve the unrelated dirty checkout; implement in an isolated worktree after approval.

## Requirement

Every open obligation has a named accountable owner, a concrete next action, a due or next-check time, and a fallback owner. A legitimate wait records what is missing, who can resolve it, and when it will be checked again. A handoff remains the sender's responsibility until accepted. A retry, reassignment, reminder, or page view must not erase elapsed age or count as completion.

The measurable promise is that unfinished work cannot silently disappear or remain unowned. Software cannot guarantee that a person responds or that infrastructure never fails. Overdue work and failed recovery must remain visible, owned, and escalatable. Timers never approve initiatives, sign reviews, accept evidence, or waive controls.

## Source findings at inspected baseline 8c7c0a0

- `components/jeeves/queue-age.tsx` and `lib/format/aging.ts` display age. Five-day and ten-day thresholds are demo display values, not enforced operational deadlines. The client clock is cached rather than continuously updated.
- `lib/db/schema.ts` stores review status and a nullable reviewer, but no distinct work assignment, acknowledgement, next-action deadline, escalation record, or worker lease. Domain authority comes from the static directory in `lib/services/actors.ts`; that is not per-item accepted ownership.
- `components/jeeves/role-aware-inbox.tsx` counts only intake drafts and conditional approvals as requester items needing input. A returned domain review can remain `in_review` and miss that count. Returned reviews remain in the reviewer's queue. The item is still accessible, but responsibility for the next action is unclear. `ReviewRow` in `lib/data/dto.ts` also omits the saved return reason, so the requester detail projection lacks the specific correction request.
- `lib/services/monitor-service.ts` opens a reassessment cycle without creating its required domain review rows. `lib/data/db-provider.ts` builds reviews from rows in the latest cycle, and the reviewer Inbox filters on those rows. A new reassessment can therefore be visible to Program Office while absent from domain reviewers' queues. `components/jeeves/reviews-tab.tsx` returns its empty state before the draft-run panel when no review rows exist, leaving no draft-start action there. Required-review approval checks correctly remain blocking; this is stuck work, not an approval bypass.
- `lib/workflow/review-run.ts` leaves unsuccessful drafts pending with a failure reason. Results already saved survive interruption, but continuation requires another invocation. There is no durable scheduled draft job, lease, or independently recoverable execution record.
- `app/api/cron/monitor/route.ts` monitors synthetic control observations and expires exceptions. It does not scan stalled work or perform deadline escalation. Its synthetic observation clock must not become the clock for real work deadlines.

These are source-based findings, not reproduced browser failures or a completed production audit.

## Proposed behavior

| Situation | Next action and owner | If it stalls |
| --- | --- | --- |
| Review ready | Named domain reviewer receives and acknowledges a review task | Route an escalation to the designated Program Office owner; retain the reviewer's task and history |
| Reviewer requests changes | Requester receives the specific missing evidence or correction with a link to the affected requirement | Reminder, then escalation; reviewer sees who is being waited on |
| Revised evidence submitted | Assigned reviewer receives a new assessment action tied to the submitted version | Deadline escalation; preserve prior versions and assessments |
| Required signatures complete | Accountable approver receives a decision action | Escalate decision delay without granting decision authority to anyone else |
| Reassessment opened | Create required review rows and owned follow-up tasks in the same transaction as the incident/cycle | Missing assignment becomes an explicit Program Office exception, never an empty success state |
| Draft attempt fails | A named operational owner receives a recovery action with the error and safe retry path | Escalate unresolved recovery; do not make people discover it in an old case |
| Owner unavailable or unknown | Program Office receives a visible assignment exception with a deadline | Reassign only to an eligible actor; keep the previous owner accountable until acceptance |
| Waiting on an external dependency | Record dependency, responsible person, check-back time and elapsed age | Recheck and escalate; blocked is an active state, not a terminal one |

Use in-app tasks and escalation records for the first slice. Email/Slack delivery is separate work requiring an approved channel and recipients. Persisting a notice does not prove anybody received or acknowledged it.

Proposed fictional-demo coordination mapping, subject to GO: Nia Okafor (`nia-okafor`) owns assignment and stalled-work exceptions; Ray Chen (`ray-chen`) is the named operational backup for coordinating recovery and eligible assignment only. This proposed narrow coordination capability grants neither domain signature nor approval authority. Encode the mapping in server-side work policy, not client-supplied roles. Current static domain assignments provide no substitute signer when a domain reviewer is unavailable; escalate that resource gap explicitly rather than inventing an authorized reviewer. A missing/ineligible coordinator or backup is an unowned/degraded exception visible to authorized operators, never successful assignment. Customer use needs organization-specific named owners and eligible backups before activation.

## First implementation slice

Cover domain reviews, requester corrections/evidence resubmission, final decision, reassessment, and draft-failure recovery. Add explicit work records and an idempotent reconciler that compares required obligations with active work. Source business records remain authoritative; tasks cannot substitute for signatures or evidence assessments.

Proposed work fields: stable ID; workspace, initiative and cycle; obligation kind and domain; source version; accountable owner and eligible fallback; status; next action; created/stage-entered/accepted/last-meaningful-progress timestamps; due/next-check time; blocker/dependency; escalation level; optimistic version. Enforce one active task per obligation/source version. Handoffs and task transitions append audit events and occur transactionally with the corresponding domain operation.

Waiting and reassignment preserve total age. SLA policies must define elapsed versus business time, risk/stage thresholds, acknowledgement deadlines, permitted pauses, and reminder cadence. Do not silently promote existing five/ten-day UI colors into customer policy. An unconfigured policy is visibly unconfigured; synthetic fixtures may use explicitly labelled demo values.

The scheduled reconciler creates missing obligations, records deduplicated escalation events, and leaves unresolved items visible until meaningful completion. Bounded batches and partial-failure results prevent one bad record from hiding the rest. Record last start, last successful completion, and errors using real server time. A stale reconciler heartbeat must show as degraded, never as a healthy empty queue. An independent operational watchdog is required before claiming unattended production coverage; checking a failed scheduler only from itself is insufficient.

## Plan

1. [File: `lib/db/schema.ts`; next additive `drizzle/*_work_items.sql`; `drizzle/meta/_journal.json`] - persist scoped work items, assignment/handoff history, deduplication keys and reconciler health. Allocate the migration number from the actual implementation base. No destructive backfill or seed reset.
2. [File: new `lib/workflow/work-items.ts`, `lib/workflow/work-policy.ts`, `lib/workflow/work-reconciler.ts`; `lib/services/actors.ts`] - define obligations, eligible ownership, safe handoffs, deadline evaluation and idempotent reconciliation. Program Office may coordinate; coordination grants no reviewer or approver permissions.
3. [File: `lib/services/initiative-service.ts`, `lib/services/evidence-service.ts`, `lib/services/monitor-service.ts`, `lib/workflow/review-run.ts`] - create/advance tasks with the matching domain operation; create reassessment review rows; close the requester-to-reviewer evidence handoff; expose failed draft recovery.
4. [File: new `app/api/work-items/[id]/route.ts` and `app/api/cron/work-items/route.ts`; `lib/services/route-guard.ts`; `vercel.json`] - guarded acknowledgement, eligible reassignment and blocker actions; authenticated bounded reconciliation. Reuse existing protection without editing credentials. Scheduling activation and hosted migrations remain separate approval steps.
5. [File: `lib/data/dto.ts`, `lib/data/db-provider.ts`, `lib/data/mock-provider.ts`, `app/(console)/inbox/page.tsx`, `components/jeeves/role-aware-inbox.tsx`; new `components/jeeves/work-items-panel.tsx`] - show owner, next action, due time, blocker and escalation; distinguish needs-my-action, waiting-on-others, and recovery work. Include a privileged stalled-work view and honest scheduler health. Resolve return reasons from their scoped source records.
6. [File: colocated work-item/reconciler and service tests; `app/api/cron/__tests__/routes.test.ts`; work-item route authorization tests; new `tests/ui/work-items.test.tsx`; `tests/e2e/golden-path.spec.ts`] - write failing cases below first, then implementation and relevant checks. Read existing tests before extending them.

## Tests

- [ ] Return a domain review: requester sees the precise correction; reviewer sees waiting-on-requester; retry does not create a duplicate task.
- [ ] Submit revised evidence: responsibility returns to the eligible reviewer; old evidence/history remain; no task closure signs or approves anything.
- [ ] Open a breach reassessment: every required domain has a review row and an owned actionable task immediately; rollback leaves neither a partial cycle nor orphan work.
- [ ] Finish required signatures: the decision task becomes actionable once; repeated sign/reconcile requests do not duplicate it.
- [ ] An unacknowledged or overdue task escalates once per policy stage; reminders and reassignments preserve original elapsed age.
- [ ] An unaccepted handoff remains owned by the sender and visible as awaiting acceptance; acceptance atomically transfers ownership. Rejection, timeout or an ineligible recipient leaves a named recovery owner and a visible reason.
- [ ] Unknown/ineligible owner becomes a visible assignment exception; cross-workspace actions, self-granted authority and Admin review/approval fail.
- [ ] Two reconcilers or reassignment requests race: one valid result, no lost owner or duplicate escalation.
- [ ] Completed or superseded obligations do not reopen; incomplete old records are reconciled idempotently without modifying historical signatures.
- [ ] Interrupted/failed draft appears as owned recovery work; retry preserves signed reviews and the atomic run budget.
- [ ] A stopped/partially failed reconciler produces stale/degraded health, not an empty healthy queue; this check uses real time rather than synthetic telemetry time.
- [ ] Browser journey: return -> requester correction -> submission -> reviewer assessment/signature -> approver task; verify role and workspace isolation throughout.
- [ ] Run relevant unit/API/UI and mocked-provider browser tests, lint and typecheck. Check real Postgres multi-connection behavior before making hosted concurrency claims; local PGlite checks alone do not establish that.

## Risk

- Permissions: task ownership cannot grant review, evidence, approval, or cross-workspace access. Revalidate eligibility when an actor takes action, including after a handoff.
- Data/history: additive schema only; no deleting/resetting existing work or audit history. Reconciliation must be version-aware and idempotent.
- External calls: initial delivery is in-app; no messages, live model calls, new provider, hosted migration or deployment in this planning round.
- Secrets/settings: reuse existing authenticated scheduling boundaries; no credential, `.env`, security-setting or developer-tool edits without explicit approval.
- Rollback: retain new tables and history when reverting application code. Back up any existing file before edits as required by repository rules; preserve unrelated dirty work using an isolated worktree.

Waiting for human GO or reviewer feedback before proceeding.

## Follow-on execution reliability

The first slice makes stalled automation an owned, visible recovery obligation. It does not turn HTTP draft execution into an automatically recovering job engine. That requires a separate bounded implementation: transactional enqueue with domain state, durable job/attempt records, leased claims, retry backoff and budgets, fenced writes after lease expiry, cancellation/supersession checks, and terminal failures routed to an accountable recovery owner. An exhausted-job queue must itself have deadlines and escalation. A process may fail after a provider response but before saving it, so retries can repeat provider calls; do not claim exactly-once execution.

Extend the same contract later to control exceptions, promotion/provenance sign-off, remediation conditions and periodic evidence refresh. Do not claim whole-product coverage from the initial review/evidence slice.
