# Jeeves — blind spots, UX/UI, features, code, and tests

Review date: 2026-09-07. Verdict: **CHANGES REQUESTED** for workflow completeness and UX correctness.

Scope: current `claude/monetization-m1` working tree, including existing uncommitted security/service changes. Read-only application review by Codex with three bounded Luna reviews. No application code, configuration, existing data, or dependencies changed. This report supersedes the implementation sequence proposed in `UX-REVIEW-2026-09-05.md`; the latest user request is review only.

The main issue is breadth without consistent completion and recovery. Nine primary navigation entries, eight case-file tabs, two intake modes, and two review surfaces are not inherently excessive, but several visible flows end before the promised task completes. Fix those before adding another screen.

## Priority findings

### 1. P1 — Identity and permission cues disagree with the authenticated actor

`lib/client/session-context.tsx:160-164` selects the requested persona then invokes `setRoleKey`, which replaces it with the role's representative persona (`components/jeeves/role-context.tsx:108-109`). A Marcus Webb login consequently authenticates Privacy/HIPAA but selects Elena Vasquez/Clinical Safety in the visible role context. A reload also resets the role context to Program Office while restoring the live session. The independent role switcher can reproduce this divergence manually.

The workbench additionally enables editing and Sign/Return based on reviewer role and cycle alone, without checking domain ownership (`components/jeeves/review-workbench.tsx:318-324,411-433`; `components/jeeves/reviews-tab.tsx:263-280`). The server rejects the wrong-domain signature after the user has already edited content. This is misleading UI authorization, not evidence of a server authorization bypass.

Use the exact authenticated persona as the live-mode source of truth and distinguish public preview switching. Gate editing and review actions on that persona's domain. Test non-default reviewers, reload, and wrong-domain review selection.

### 2. P1 — Intake has dead ends and loses work

- Chat stores a completed payload and displays “Intake complete,” but provides no create, submit, or transfer-to-form action (`components/jeeves/intake-chat.tsx:79-86,152-179`). Finishing the interview cannot enter the governance workflow.
- Existing draft records render “Continue intake” without an action handler (`components/jeeves/intake-tab.tsx:81-83`). It stays disabled even for a live requester.
- Switching form/chat panels unmounts their local draft state (`components/jeeves/intake-mode-toggle.tsx:21-25`; installed Base UI panel defaults to `keepMounted = false`). Returning loses the answers or conversation.
- Submit always creates before attempting submission (`components/jeeves/intake-form.tsx:300-329`). If create succeeds but submit fails, retry creates a second draft.

Use one editable intake draft with an explicit review-and-submit step; let chat populate it. Retain created IDs for retries and show persistent recovery links. A lost response to creation itself requires server idempotency; preserving a successful response only addresses the known-created-record case.

### 3. P1 — Draft-run progress and completion are overstated

The POST route awaits the entire fan-out (`app/api/initiatives/[id]/draft-run/route.ts:125-127`; `lib/workflow/review-run.ts:258-291`). Only after that response does the UI announce the run has started and begin polling (`components/jeeves/reviews-tab.tsx:73-79`). This does not deliver the advertised per-domain progress while drafting.

The poller then considers failed rows terminal and emits a success message, including when its polling limit is reached (`components/jeeves/reviews-tab.tsx:88-100`). A partially failed run can therefore say all drafts are ready.

The runtime is a synchronous, resumable-by-reinvocation worker pool. The generic `WorkflowPort` contract for background execution/events/pause/resume/cancel exists only as types and test stubs (`lib/agents/ports.ts:321-437`; `tests/ports.test.ts:111-179`), not a wired implementation. Do not use those stub tests as durability evidence.

For a small demo, simplify to an honest synchronous progress state with per-domain final results and explicit retry. A real background job/resume mechanism is a separate implementation decision under the existing plan; it cannot be achieved by renaming a type or retaining the current poller.

### 4. P1 — Operational status can assert facts unsupported by evidence

- Every paused/re-review initiative is labeled an eval-quality breach with an open reassessment cycle (`app/(console)/initiatives/[slug]/page.tsx:106-116`; `components/jeeves/initiative-blockers-rail.tsx:20-21`). A manual pause records its reason without creating those incident/cycle records (`lib/services/admin-service.ts:303-340`).
- Incident-query failures are caught and converted to `[]` in Inbox, Monitoring, and Admin (`app/(console)/inbox/page.tsx:24-38`; `monitoring/page.tsx:51-65`; `admin/page.tsx:37-53`). If that query fails independently of the other page reads, the UI can report “No incidents recorded” instead of unavailable data.
- Monitoring decorates the latest value as “over floor” if *any* historical point was high (`app/(console)/monitoring/page.tsx:68-75,185-191`). A recovered current reading can look breached. The actual control evaluator requires consecutive observations (`lib/controls/evaluate.ts:46-100`).

Use recorded cause and incident evidence; distinguish current readings, historical breaches, and unavailable incident data. A missing value or failed read must not become a clean-health assertion.

### 5. P2 — The central review queue excludes keyboard users and obscures pending work

Review selection is attached only to table-row clicks (`components/jeeves/review-workbench.tsx:183-191`); there is no keyboard-focusable selection action. Domain filter buttons also lack selected-state semantics (`:113-159`). The route removes pending reviews (`app/(console)/reviews/page.tsx:19-23`), then the empty workbench tells users to select a row that does not exist (`review-workbench.tsx:291-295`).

Provide named row buttons, keyboard activation, selected-state semantics, and an empty state distinguishing “nothing awaiting signature” from “drafts not started.” Preserve access to the pending initiative. Group each intake Yes/No pair under a fieldset/legend rather than six questionless Yes/No pairs (`components/jeeves/intake-form.tsx:652-681`).

### 6. P2 — Navigation promises interactions it does not deliver

Global search has no handler, state, results, or submission (`components/jeeves/app-topbar.tsx:25-33`). Remove the inert input until a scoped search exists. Case-file tab clicks do not update the URL (`app/(console)/initiatives/[slug]/page.tsx:123`), so copied links, reload, and browser history do not follow the active tab. The metrics strip still directs users to filter using the removed pipeline board (`components/jeeves/outcome-metrics-strip.tsx:102-104`).

Use working navigation controls, URL-backed tabs, and copy that refers to current screens. The top bar's non-wrapping live-session controls and fixed-height wrapping case tabs also warrant narrow-viewport checks; overflow has not been browser-verified in this review.

### 7. P2 — Portfolio screens repeatedly reload the whole portfolio

`DbDataProvider.loadSnapshot()` performs ten table queries (`lib/data/db-provider.ts:186-211`). `getInitiativeDetail()` calls it for each detail (`:383-390`). Inbox, Reviews, Monitoring, and Admin first list initiatives and then load every detail independently (for example `app/(console)/reviews/page.tsx:10-13`). Twelve initiatives cause about 130 baseline snapshot queries for list plus details, before extra detail queries. Every snapshot scans records across workspaces before output filtering.

Add a bulk viewer-scoped read or a request-scoped snapshot shared by that page. Do not add a process-global snapshot cache that could leak stale/cross-workspace data. This is direct query-path evidence, not a measured production-latency claim.

## Code that can be removed or consolidated

| Candidate | Evidence | Recommendation |
| --- | --- | --- |
| `components/jeeves/pipeline-board.tsx` | `PipelineBoard` has no production consumer; only `tests/ui/pipeline-board.test.tsx` imports it. Current routes use `PortfolioView`, `InitiativeTable`, and `RoleAwareInbox`. | Remove the old component and its four dedicated tests together after approval; update stale board instructions. |
| `components/jeeves/sla-callouts.tsx` | No source/test consumer; five hardcoded storyline callouts are superseded by the Inbox. | Remove rather than reconnect stale hardcoded state. |
| `lib/format.ts` and `tests/smoke.test.ts` | Placeholder `slugify` is imported only by those three smoke tests; creation has its own slug function. | Remove the unused helper and its tests together. Do not alter the production slug/uniqueness behavior as part of this cleanup. |
| `tests/ports.test.ts` runtime stubs | Assertions exercise locally invented event/results/no-op methods, including a broad cast, rather than a production workflow implementation. | Keep useful compile-time checks; remove the pretend runtime contract validation. |
| Three copies of incident loading | Inbox/Monitoring/Admin repeat the same fetch, workspace filter, and catch-to-empty policy. | Consolidate behind a typed success/unavailable result while preserving viewer isolation. |
| Two review action implementations | Workbench and case-file Reviews each implement sign/return, pending/error handling, and eligibility. | Share the behavior and authorization derivation; retain the queue and case-file contexts. |
| Duplicate provider selectors | `lib/data/index.ts:21-33` and `app/_lib/data-provider.ts:35-45` duplicate selection; the latter documents a bundler workaround. | Consolidate only after confirming the original Next/Turbopack failure is resolved. This is not safe blind deletion. |

Also audit unused advisory capabilities (`triageAssist`, `checkCompleteness`) before expanding them: repository call searches show adapter implementations and tests but no production call site. The deterministic triage/completeness functions are authoritative and in use; retain those. Any port/spec reduction should be an explicit plan amendment.

## Features to simplify, not silently delete

These are product recommendations, distinct from confirmed defects. `plan.md` explicitly approved full breadth and all eight governance domains.

- Keep intake, domain review/signature, accountable decision, effective controls, version promotion, monitoring incidents, and audit evidence as the central journey.
- Make chat an optional helper inside the same intake draft; hide the standalone mode until it can complete submission.
- Move agent catalog/debug detail below the main workflow navigation. Capability names and source instruction paths (`app/(console)/agents/page.tsx:67-94`) do not help a requester submit or a reviewer sign.
- Put GPU utilization and synthetic trace demonstrations under an optional Monitoring details section. They currently precede deployments and incidents (`app/(console)/monitoring/page.tsx:119-146`). Keep the required synthetic/connector labels visible.
- Remove the simulated “Last sync” field unless explicitly labeled as an example next to the value. It is generated from a fixed timestamp without a network sync (`lib/telemetry/connector.ts:52-56`), so it supplies no health evidence.
- Reach version promotion/history from Deployments, with the separate queue available for bulk work. Avoid making every demo capability a primary navigation destination.
- Drop the decorative fixed cycle-time sparkline (`components/jeeves/outcome-metrics-strip.tsx:9-14`) or label it illustrative; the general tooltip currently says it is computed from source events.

## Test review

The test count alone is not excessive. The imbalance is between well-covered domain invariants and under-covered user completion/recovery.

**Remove/consolidate:** the unused pipeline/slug tests above; duplicate LandingPage CTA/sidebar assertions in `tests/ui/landing-page.test.tsx:34-55` and `tests/ui/marketing-pages.test.tsx:96-119`; runtime assertions that only prove hand-written port stubs return their own constants.

**Keep:** authorization and workspace tests at route and service layers; CAS/race/idempotency tests; DB append-only/uniqueness tests; deterministic tier/completeness/approval rules; framework mapping integrity; per-component aging wiring; one disclaimer/browser assertion per separate layout family. These cover different boundaries and should not be collapsed merely because their names look similar.

**Add where failures matter:** persona identity/reload, wrong-domain editing, keyboard review selection, chat-to-submit, retained intake drafts, create-success/submit-failure retry, partial agent failure, unavailable incident data, and manual pause versus monitor breach. Exception renewal also lacks direct HTTP-route coverage despite service tests (`app/api/exceptions/[id]/renew/route.ts:16-53`).

The live mutation browser test self-skips without runner `DEMO_PASSCODE` (`tests/e2e/golden-path.spec.ts:180`). Even when enabled, it ends after generated controls, without browser coverage of promotion -> monitor breach -> reassessment. Require an explicit mocked live-workflow lane; a green read-only lane must not imply this journey was verified.

## Verification and scope limits

- Full current-tree suite: **76 files / 872 tests passed**, 162.40 seconds. Collected from the run started earlier in this review session; no application source changed between that run and this report.
- UI suite: **31 files / 138 tests passed**.
- TypeScript: passed (`tsc --noEmit --incremental false`).
- ESLint: zero errors; one existing warning in generated `coverage/block-navigation.js`.
- Browser/viewport/screen-reader QA, live provider behavior, production performance, and a fresh external dependency audit were not performed. The standard E2E command wipes/reseeds local data, so it was not run against the existing workspace. Use a reviewed disposable store for that validation.
- No code deletion, configuration change, commit, push, merge, migration of existing data, or deployment occurred. Only review documents and the required append-only build log were written.

Recommended order: repair completion/recovery and truthful status, unify persona/action state, remove confirmed dead code and its tests, then reduce default navigation/telemetry clutter. Broad feature deletion or new infrastructure should be a separate decision.
