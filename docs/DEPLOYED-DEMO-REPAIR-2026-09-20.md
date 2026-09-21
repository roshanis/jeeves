# Deployed demo failure repair

## Confirmed production diagnosis

The supplied screenshot targets `https://jeeves-three.vercel.app`. Production is serving main `69d971c`. A direct session request returned HTTP 500. The matching runtime log reports `EROFS: read-only file system, mkdir '/var/task/.pglite'` from the database-backed session rate limiter.

Project environment metadata lists Supabase integration `POSTGRES_URL` variables, but no `DATABASE_URL` and no `JEEVES_COOKIE_SECRET`. The former name mismatch makes the API attempt local PGlite while page and incident selectors use the mock preview. Integration database values are marked sensitive and are deployment-only; they were not printed or copied into files.

## Bounded implementation

- Resolve the trimmed explicit `DATABASE_URL`, then integration `POSTGRES_URL`, consistently for the DB client, pages, incident reads and migration tooling. Preserve explicit mock overrides for deliberate preview/tests.
- Reject URL-free local PGlite in Vercel runtime. Preserve ordinary local development and Neon support; use PostgreSQL wire protocol and verified TLS for Supabase with a bounded pool.
- Match migration driver to its connection and keep direct/session migration URLs separate from transaction-pooled runtime URLs. No migration has been run against a hosted database.
- Preflight signing before storage access. Session-store failures become a coded, retryable 503; diagnostics omit raw queries, private endpoints, credentials and client identifiers.
- Keep all local/browser tests offline by blanking both runtime URL aliases.

## Deployment work still pending

The user approved configuration, staged verification and publication. A fresh server-only `JEEVES_COOKIE_SECRET` has now been added as a sensitive production variable through stdin, without printing or storing its value locally. The remaining steps are to create a staged deployment using the existing integration variables, inspect database/schema readiness and test session creation/persona switching before promoting it. Existing database state must be preserved. Do not run seed/reset to repair an existing database; any missing-schema or fresh-demo initialization work needs a separately scoped decision after inspecting the target.

The separate prepared incident-banner change has not been imported: fixing the shared provider selection addresses the source of the preview notice. No claim of hosted recovery is made before the staged checks pass.

## Validation

Independent Luna final review approved the code with no remaining blocker. The user explicitly approved hosted configuration, staged verification and publication in the following turn.

TDD reproduced the POSTGRES_URL-only page/incident/coherent-detail failures (3 failing cases), then the provider suite passed 8 tests. Session TDD reproduced the missing-key database access and escaped storage failure before their fixes; targeted session/client checks pass, including credential-free log assertions. The full offline suite passed 132 files / 1,314 tests with 89.23% line coverage. Production-build Playwright passed all 28 tests, including passwordless entry, persona switching, the complete governance loop and responsive layouts. The relocated packaged-agent check passed with zero network calls; its local dependency directory is a reused symlink, so this validates packaged application assets rather than complete image portability. Full lint, typecheck and whitespace checks passed; the production dependency audit reported zero vulnerabilities.

Final review identified an additional migration edge case: a supplied PGlite handle must ignore an unrelated ambient Supabase transaction-pool URL. Its new regression failed before the fix, then all seven DB/migration suites passed 46 tests after the correction. Typecheck, scoped lint and whitespace checks passed again. The full 1,314-test run and browser build preceded this final migration-only correction; affected suites were rerun afterward. Browser navigation emitted a destination-stream-closed server warning without a test failure.

All 95 fingerprinted original-checkout files were unchanged before the required append-only build log update. No live LLM request, hosted migration, seed/reset, commit, push, merge or repair deployment has occurred in this round.

Evidence files:
- `/tmp/jeeves-deployed-demo-provider-red.log` and `/tmp/jeeves-deployed-demo-provider-green.log`
- `/tmp/jeeves-deployed-demo-unit-final.log`
- `/tmp/jeeves-deployed-demo-e2e-final.log`
- `/tmp/jeeves-deployed-demo-bundle-final.log`
- `/tmp/jeeves-deployed-demo-lint.log` and `/tmp/jeeves-deployed-demo-typecheck.log`
- `/tmp/jeeves-deployed-demo-audit.json`

Updated 2026-09-21T02:41:47Z.
