# Deployed demo failure repair

## Confirmed production diagnosis

The supplied screenshot targets `https://jeeves-three.vercel.app`. At the initial diagnosis, production was serving main `69d971c`. A direct session request returned HTTP 500. The matching runtime log reports `EROFS: read-only file system, mkdir '/var/task/.pglite'` from the database-backed session rate limiter.

Project environment metadata lists Supabase integration `POSTGRES_URL` variables, but no `DATABASE_URL` and no `JEEVES_COOKIE_SECRET`. The former name mismatch makes the API attempt local PGlite while page and incident selectors use the mock preview. Integration database values are marked sensitive and are deployment-only; they were not printed or copied into files.

## Bounded implementation

- Resolve the trimmed explicit `DATABASE_URL`, then integration `POSTGRES_URL`, consistently for the DB client, pages, incident reads and migration tooling. Preserve explicit mock overrides for deliberate preview/tests.
- Reject URL-free local PGlite in Vercel runtime. Preserve ordinary local development and Neon support; use PostgreSQL wire protocol and verified TLS for Supabase with a bounded pool.
- Match migration driver to its connection and keep direct/session migration URLs separate from transaction-pooled runtime URLs. Hosted initialization is recorded separately below.
- Preflight signing before storage access. Session-store failures become a coded, retryable 503; diagnostics omit raw queries, private endpoints, credentials and client identifiers.
- Keep all local/browser tests offline by blanking both runtime URL aliases.

## Hosted repair and staged verification

The user approved hosted configuration, staged verification and publication. A fresh server-only `JEEVES_COOKIE_SECRET` was supplied through stdin as a sensitive production variable without printing or storing its value locally. The official project Dashboard certificate was configured as `DATABASE_SSL_CA` after staging exposed an untrusted certificate chain. Certificate verification remains enabled. Only clean git archives were uploaded; the initial dry worktree manifest included generated reports and was never uploaded.

A read-only check then confirmed the configured Supabase database had zero public tables and no Drizzle journal. The user separately approved installing existing migrations `0000`–`0012`, restricting app access by public API roles, and testing entry. The reviewed SQL transaction guards against existing objects, records exact Drizzle hashes and timestamps, enables RLS on all 19 app tables, and revokes only app-object access from PUBLIC, anon and authenticated. An effective-privilege postcondition rolls back if inherited permissions remain. It preserves server-owner access and Supabase-managed objects.

Root executed that exact transaction in the authenticated SQL Editor. Read-only verification returned 19 app tables, 19 RLS-enabled tables, 13 migration records, zero relations accessible by anon/authenticated, and zero initiative rows. No seed, reset or data deletion was run. The artifact SHA-256 is `9fa82f9fcf0652651c05545ad0a7c036c79d8316db4854dc8048efa61a74aaf2`. Independent audit and ephemeral PGlite tests cover successful initialization, existing-data guard preservation, inherited-access rejection, and absent API roles.

On staged commit `bb2a38d`, database health and passwordless session entry returned HTTP 200. The secure signed workspace cookie was issued; persona switch and switch-back returned 200, preserved the workspace, and recognized persisted sessions across requests. These probes wrote only isolated demo session and rate-limit state. Business/catalog seed data and live LLM behavior are outside this verification.

Main advanced through PR17 during release, so the repair now integrates its shared ESM provider factory and explicit read-only preview policy. Both the newly added mutation guard and layout capability must recognize POSTGRES_URL as well as DATABASE_URL. A regression reproduced the incorrect read-only denial under an integration-only configuration before that reconciliation was fixed. PR16's incident notice changes are also preserved.

Canonical production recovery remains pending verification of the final integrated commit and deployment. PR18 and the release evidence record will contain the resulting deployment identifiers and public checks.

## Validation

Independent Luna final review approved the code with no remaining blocker. The user explicitly approved hosted configuration, staged verification and publication in the following turn.

TDD reproduced the POSTGRES_URL-only page/incident/coherent-detail failures (3 failing cases), then the provider suite passed 8 tests. Session TDD reproduced the missing-key database access and escaped storage failure before their fixes; targeted session/client checks pass, including credential-free log assertions. The full offline suite passed 132 files / 1,314 tests with 89.23% line coverage. Production-build Playwright passed all 28 tests, including passwordless entry, persona switching, the complete governance loop and responsive layouts. The relocated packaged-agent check passed with zero network calls; its local dependency directory is a reused symlink, so this validates packaged application assets rather than complete image portability. Full lint, typecheck and whitespace checks passed; the production dependency audit reported zero vulnerabilities.

Final review identified an additional migration edge case: a supplied PGlite handle must ignore an unrelated ambient Supabase transaction-pool URL. Its new regression failed before the fix, then all seven DB/migration suites passed 46 tests after the correction. Typecheck, scoped lint and whitespace checks passed again. The full 1,314-test run and browser build preceded this final migration-only correction; affected suites were rerun afterward. Browser navigation emitted a destination-stream-closed server warning without a test failure.

All 95 fingerprinted original-checkout files were unchanged before the required append-only build log update. The initial local checks preceded the separately approved hosted work recorded above. No seed/reset or live LLM request has been run.

Evidence files:
- `/tmp/jeeves-deployed-demo-provider-red.log` and `/tmp/jeeves-deployed-demo-provider-green.log`
- `/tmp/jeeves-deployed-demo-unit-final.log`
- `/tmp/jeeves-deployed-demo-e2e-final.log`
- `/tmp/jeeves-deployed-demo-bundle-final.log`
- `/tmp/jeeves-deployed-demo-lint.log` and `/tmp/jeeves-deployed-demo-typecheck.log`
- `/tmp/jeeves-deployed-demo-audit.json`

Updated 2026-09-21T03:20Z.
