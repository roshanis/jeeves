# Visitor playground

Implemented locally following the user's request to remove passwords and let visitors play. Branch: `codex/visitor-playground-20260920`, based on cached `origin/main` at `ac9404e`. This supersedes the earlier proposed password-removal plan in the original dirty checkout.

## Visitor experience

- **Try the demo** on the public site starts a requester session and opens editable intake in one click.
- **Use a sample initiative** fills a fictional scenario that is ready to submit, while explicitly retaining its intended evidence/retention gaps for review.
- **Demo persona** in the header switches among all 13 fictional personas without a password or logout step. Requester, domain reviewer, approver, program and admin views use server-issued sessions in the same browser workspace.
- **Start demo** is also available directly from the console and intake page. Entry errors are visible and retryable; controls share one in-flight request and display pending state.
- Shared sample initiatives remain viewable. Visitors can edit, submit, review and approve their own records; shared examples and global threshold defaults are read-only. The threshold editor offers only workspace overrides.

## Boundaries preserved

Business mutation routes require valid, expiring, non-null workspace sessions. Service checks deny writes to shared examples and foreign workspaces, including derived review, exception, deployment, threshold and monitor records. Public read filters remain separate. Role/domain/requester ownership, separation of duties, input caps, append-only audit and atomic model budgets remain intact. Trusted scheduled monitoring keeps its existing unscoped behavior.

Anonymous session creation and authenticated persona switching use separate persistent limits. An invalid supplied switching token does not mint a new session. Valid parent-session workspace identity wins over a conflicting browser cookie. Current schema already prohibits null session workspaces; an additional fail-closed route guard is tested by simulating a legacy schema only in disposable PGlite.

This is fictional role-play, not verified customer identity. Existing tokens follow their existing one-hour expiry; Exit demo clears the current tab's session and does not revoke all server tokens.

## Signing configuration

New deployments use a random server-only `JEEVES_COOKIE_SECRET`. The visitor never enters it. Existing `DEMO_PASSCODE` configuration remains solely as a deprecated signing fallback: it signs new workspace cookies and verifies existing ones until an independent key is configured. No passcode is verified at session entry. With neither signing source configured, entry returns a safe 503 without creating a session. Replacing signing material invalidates prior workspace cookies but does not revoke unexpired session tokens.

No credential files or hosted configuration were accessed or changed. No database migration is required. A local preview runs at http://localhost:3121 using a newly created disposable PGlite directory, a process-only random signing key, and mocked agent providers.

## Validation

- TDD: passwordless entry/UI and mutation ownership regressions failed before implementation, then passed. Threshold UI tests failed before removing global edits, then passed. The simulated legacy-null session regression failed before adding the defensive HTTP check, then passed.
- Full offline Vitest coverage: **120 files, 1,206 tests passed**; **87.86% line coverage**, configured thresholds pass. Log: `/tmp/jeeves-playground-unit-final.log`.
- Production webpack build and Playwright: **28/28 passed**, including requester → reviewer → approver workflow, evidence submission/revision/download, passwordless landing entry and responsive/mobile persona switching. Log: `/tmp/jeeves-playground-e2e-r2.log`.
- Typecheck, lint excluding generated coverage/Playwright artifacts, and diff whitespace checks pass. An initial lint run raced Playwright's generated-directory cleanup; the rerun passed. An initial browser build sampled in-progress test edits and was rerun successfully after they were completed.
- Focused specialist-reviewed regressions passed: 190 service tests and 60 API tests. Independent Luna backend/frontend/final diff review found no remaining functional or safety blockers; documentation findings were corrected.
- Direct in-app browser review of the isolated preview verified one-click entry, editable sample intake, no password dialog, and no captured browser errors on that path. Browser suite logs contain one destination-stream-closed warning during navigation; this is not a blanket error-free or hosted readiness claim.

Existing dependencies were reused through a local untracked symlink; no packages were installed or changed. Existing unrelated original-checkout files were fingerprinted and preserved; only the required original build-log append belongs to this task. No commit, push, merge, production deployment, hosted database change, or live-provider request was performed. A production rollout still needs the normal human merge approval and verification of deployed signing configuration.
