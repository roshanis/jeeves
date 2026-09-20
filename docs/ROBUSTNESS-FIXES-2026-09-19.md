# Jeeves robustness fixes — 2026-09-19

Implementation branch: `codex/robustness-fixes-20260919`.
Base: cached `main` at `f71b6bc62ab40d95e14d1d729d0c838e0fca12a9`.
Scope: R1–R8 of the Astra robustness review prompted by *The Pragmatic Programmer* and *Designing Data-Intensive Applications*. User authorized fixes; Astra extra-high plan review approved the bounded implementation. No commit, merge, deployment, hosted migration, or live provider call was performed.

## Behavior and evidence

| Finding | Implemented guarantee | Regression evidence |
| --- | --- | --- |
| R1: unseen draft signing | Sign commands carry the displayed review revision and explicit submitted evidence packet identity. Stale commands return 409. UI preserves human edits, captures return-dialog revision, and requires explicit re-review after a conflict. | Service, API, client and UI snapshot-contract tests; browser golden path checks wire payload. |
| R2: approved history could change | All review mutations lock the initiative before rereading cycle eligibility. Closed/noncurrent cycles reject mutation. Signed text, hash, actor, revision and evidence identity are preserved in an immutable audit receipt; decisions reference those receipts or explicitly labeled legacy snapshots. | Actual Postgres approval/return races in both serial orders; stale signature and closed-cycle tests. |
| R3: duplicate/late model writes | Database claim IDs, leases and content revisions fence both success and failure. Duplicate domains are deduplicated; concurrent calls invoke one provider. Sign/return invalidate active attempts. | Separate-connection Postgres claims, expired claims, late failure and human-return races. |
| R4: evidence gaps displayed as citations | Citations, missing evidence and control-linked evidence requests are stored separately. Model references remain labeled unverified; existing rows remain legacy-unverified. | Adapter schema/mapping tests; persistence and UI tests. |
| R5: draft without actor receipt | Accepted draft and actor-attributed audit event commit in one short transaction. Provider calls run outside the transaction. | Fault injection rolls back the result when audit insertion fails, including actual Postgres append-only trigger checks. |
| R6: unsafe reservation accounting | Authorization and eligibility precede reservations. Both routes share runtime-aware estimates; every retry reserves separately. Duplicate/no-op work consumes no reservation. Cancellation/deadline while waiting for the reservation transaction rolls it back. | Service and HTTP budget tests; concurrent quota-cap tests; deadline tests. |
| R7: unbounded provider attempts | Provider calls receive cancellation and bounded timeouts. Default run budget 90 seconds, attempt 30 seconds, two attempts, transient retry backoff. Dispatch and accepted persistence recheck elapsed time after database waits. | Stalled-provider and late-persistence regressions; explicit fan-out timeout outcomes. |
| R8: incomplete/unpinned grounding | Draft inputs use the cycle’s pinned intake/risk snapshot, complete domain policy, applicable controls, and submitted evidence metadata/assessments. Source and prompt hashes persist alongside results; changed context rejects stale completion. | Grounding tests cover pinned intake, missing/truncated policy, submitted versions and metadata; provider adapter provenance tests. |

## Validation

- Full unit/API/UI suite: **1,263 tests across 124 files passed** (279.70 seconds).
- Real PostgreSQL 16: **9 tests passed**, using independent connections in an empty, private Unix-socket cluster; the cluster was shut down after testing.
- Production-build Playwright golden path: **14 tests passed** on the final UI snapshot, including the sign command payload, evidence revisions, and desktop/mobile review.
- Final focused deadline/budget checks: **20 tests passed**. HTTP authorization/isolation/budget checks: **42 tests passed**.
- Full TypeScript typecheck, ESLint, and whitespace checks passed.

All model responses are mocked or synthetic. The browser harness uses disposable local PGlite and explicitly blanks provider/database credentials. No live provider, hosted database, or external security audit was invoked.

Independent Astra extra-high implementation reviews found and resolved additional deadline/reservation/error-reporting and skipped-outcome UI issues. These checks establish local behavior, not hosted readiness.

## Schema and deployment boundary

`drizzle/0012_review_integrity.sql` adds revision, active-attempt, signature receipt, evidence-gap and provenance fields. Existing records receive revision 0 and `legacy-unverified`; no historical signer or evidence truth is fabricated. The existing append-only audit protection is retained.

Apply the additive migration using the project’s reviewed migration procedure before deploying this server/client pair. Signing intentionally fails closed when the integrity columns are unavailable. Old clients lacking required sign/return revision fields must refresh; the server never substitutes its latest revision for an unseen client version. No hosted database has been changed here. A deployment should verify the migration, reload clients and exercise the signature/return workflow in its own staging environment.

## Limits that remain explicit

- Execution is still request-bound. Claims expire so a later invocation can recover; this change does not install a durable background workflow engine or automatic wakeup after a process crash.
- Provider execution and result acceptance are deadline-fenced. Database connection/lock waits do not have a hard total HTTP deadline.
- Token reservations are estimates, not measured provider usage or a hard dollar spending cap. Capacity may remain reserved after a request was dispatched but its outcome became uncertain; there is no unsafe automatic refund/replay.
- Evidence grounding uses submitted document metadata and recorded assessments. It does not read document contents or certify sufficiency. Deep prompt hashes cover initial input, not an unrecorded tool transcript.
- Runtime packaging/readiness R9 is owned by the separate active demo-agent task. Its uncommitted changes were not copied into this branch.
- The original dirty monetization checkout and the separate demo-agent worktree are preserved.

## Reproducing the Postgres checks

`npm run test:postgres` is opt-in and refuses an unspecified/non-disposable database. It requires an empty database in a new task-owned `jeeves-review-pg-*/data` directory and sibling Unix `socket` directory, with PostgreSQL listening on no TCP address. The following explicit environment variables identify that disposable cluster: `JEEVES_REVIEW_TEST_PG_SOCKET`, `JEEVES_REVIEW_TEST_PG_DATABASE` (prefix `jeeves_review_integrity_`), `JEEVES_REVIEW_TEST_PG_USER`, and marker `JEEVES_REVIEW_TEST_PG_MARKER=disposable-review-integrity`. The helper verifies server identity and empty schema before migration and never drops a database. This run used a private PostgreSQL 16 cluster and shut down only that cluster afterward.
