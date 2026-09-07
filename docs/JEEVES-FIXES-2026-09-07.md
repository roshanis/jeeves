# Jeeves UX and recovery fixes — 2026-09-07

Implemented after the user requested fixes with Sol subagents and the required plan received Sol reviewer approval. The earlier review documents record the baseline findings; this document records remediation.

The original implementation was verified on `codex/ux-fixes-20260907`. After the user requested a merge, its baseline-relative UX patch was integrated onto current main (`5f6c97f`) on `codex/ux-main-integration-20260907`. The original checkout and its preexisting changes remain preserved; all 334 source hashes match the backup. Newer main design, mobile, security, agent-adapter, license, and CI changes are retained.

## Changes

- Live sessions restore the exact persona and expire locally. The public preview selector is clearly labeled; live sessions cannot independently change its identity. Reviewer edits and signing actions follow the authenticated domain and current review status.
- The keyboard-accessible review queue includes pending drafts, retains unsaved assessments across selection, and refreshes selected rows from current server data. Draft runs show synchronous per-domain outcomes with targeted retries; failed runs no longer report all drafts ready.
- Form and chat share an intake payload and retain work across tabs. Chat transfers answers into the form for review and submission. Owners can continue persisted drafts through an authenticated edit route. Creation retries use stable random request keys, and versioned updates serialize against submission.
- Case-file tabs update the URL and support reload and browser history. Mobile navigation emphasizes the main workflow and groups Agents, Promotions, and Administration under More tools. Deployments links to the promotion queue.
- Paused cases show recorded reasons. Incident reads distinguish unavailable data from a verified empty result. Current evaluation flags use the latest reading. Blockers include unsigned drafted reviews and no longer claim completion when evidence or reviews are absent.
- Portfolio pages load case-file details through one request-local bulk provider read. Twelve separate detail snapshot loads are replaced by one 11-query snapshot; viewer/workspace filtering remains in place. No global data cache was introduced.
- Removed unused PipelineBoard, SlaCallouts, and the unused slug helper with their dedicated tests; consolidated duplicate landing assertions and replaced runtime port-stub tests with compile-time contracts. Removed inert global search and the fixed decorative sparkline. GPU/trace demonstrations and agent implementation details remain available behind disclosure controls, with synthetic labels retained.

## Original implementation validation

- TypeScript and ESLint: passed on the final code.
- Production webpack build and disposable Playwright lane: **12/12 passed**, including chat → shared form → creation/submission → eight-domain triage/drafting → own-domain signing → conditional decision → audit/deployments/controls. URL reload/Back/Forward and keyboard tab selection passed.
- Chromium browser inspection: final mobile viewport and document width both 390px; no horizontal overflow or browser errors. Desktop review queue and human-readable persona labels inspected. Artifacts: `/private/tmp/jeeves-review-artifacts-20260907`.
- Independent Sol review: root-owned changes, identity/review behavior, and final intake recovery/route changes approved with no remaining concrete blockers.
- Final full suite: **83 files / 906 tests passed** in 201.88s. Coverage thresholds passed: 86.65% statements, 77.16% branches, 91.85% functions, 87.77% lines. This includes existing authorization, workspace isolation, audit, transition, and database invariant tests.

The browser lane uses a fresh temporary PGlite database, a fixed test-only session configuration, and blank external database/LLM environment values. Existing databases and credentials are not touched.

## Limits and retained scope

All eight governance domains, human decision authority, audit records, workspace authorization, and database invariant tests remain. This cleanup does not implement durable background workflow infrastructure or remove approved product breadth.

Promotion → monitor breach → reassessment remains covered at service/route level, without a complete browser story for a new initiative's separate promotion-provenance setup. Real OpenAI/Neon behavior, production performance, and screen-reader interaction have not been verified in this round. The separate exception-renewal HTTP route was not changed in this round; its previously identified direct-route coverage gap remains a follow-up. The dependency-audit findings below remain a release concern; this work makes no production-ready claim.

## Current-main integration validation

- Full suite: **97 files / 1,057 tests passed** in 254.60s. Coverage gates passed: 87.08% statements, 77.17% branches, 92.09% functions, 88.15% lines.
- TypeScript, ESLint, and staged diff checks passed.
- Production webpack build and **25/25 Playwright tests passed**, including the workflow above and current main's mobile-responsive tests. All database/LLM isolation settings remain active.
- Independent Sol main-relative review approved backend/data/intake/config and status/navigation integration without concrete blockers.
- New draft read/update routes explicitly conceal shared seed and foreign-workspace rows from live actors. Current main's other security and concurrency behavior is retained.
- Fresh production dependency audit: **12 inherited findings (10 high, 2 moderate; no critical)**. Package manifest and lockfile are unchanged from main. Dependency remediation remains separate work.
- Local logs: `/private/tmp/jeeves-review-backup-20260907/main-integration-tests.log` and `main-integration-e2e.log`. GitHub PR checks remain a separate required merge gate.
