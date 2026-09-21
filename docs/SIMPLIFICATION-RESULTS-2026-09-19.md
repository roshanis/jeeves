# Jeeves simplification and maintenance map

Implemented locally on `codex/simplification-fixes-20260919`, following the user's
R2 review and explicit instruction to fix. Astra xhigh specialists implemented
separate areas and reviewed one another's changes. The original dirty checkout
was not used for implementation. The user subsequently authorized merging; the
integration incorporates current main `7414d90`, including PR14's review-integrity
protections, with independent Astra review of the combined behavior.

## What became simpler

- One intake definition supplies persisted answers and strict model output.
  A revision-aware editor prevents delayed chat from replacing manual changes.
- Explicit operational-deployment and current-control selectors replace
  conflicting choices. Historical rows remain available on case details.
- Review commands live in the evidence-led workbench. Direct links carry the
  case/domain; server IDs and displayed revisions replace browser-registry
  authority. Signatures bind to the submitted evidence packet.
- Decision readiness is shared by server validation, portfolio projection and
  UI. Reassessments enter the review queue and can reach an explicit admin resume
  after approval. Rollback remains on the case's Deployments tab.
- AI results retain citations, control references, confidence notes and generation
  provenance, with evidence gaps stored separately from policy references.
  Both live SDKs share cancellation/deadline behavior and runtime configuration.
- Mock and database fixtures share personas, reviewer assignments, controls and
  initiative facts. Provider facades no longer cache stale database handles.
- Preview reads and writes agree: static previews cannot issue live sessions or
  mutate through session or cron endpoints.

## Removed

- Uncalled triage/completeness adapter methods, their exclusive schemas/tests,
  the unused triage prompt, and speculative WorkflowPort/event interfaces.
- Duplicate signing/returning and promotion-only rollback command owners.
- Unused DropdownMenu/Skeleton components and five starter SVGs.
- Unused in-memory rate limiter, obsolete reset/accessor helpers, tautological
  adapter type checks, redundant copy assertions and repeated timeout wrappers.
- The monitor's unused AI initialization and unused mock narration metadata.

Tests still protect authorization, workspace isolation, audit atomicity,
signatures, evidence versions and concurrency. Pure migration-label checks no
longer start a database. `tsx`, already present in the lockfile, is now declared
directly because project scripts use it; no package version was upgraded.

The integrated tree removes **1,637 net production source lines** across 69 changed
production paths, counting new files as well as deletions. The comparison is
against `origin/main` at `7414d90`, so it excludes the separately merged runtime
and review-integrity fixes. This counts TypeScript/JavaScript source, including configuration
and scripts, and excludes tests, documentation and generated files.

## Verification

- Integrated unit/API/UI suite: **146 files, 1,419 tests passed**; coverage
  thresholds pass with **89.33% lines**, 87.25% statements, 79.4% branches and
  93.04% functions.
- Production-build Playwright: **28/28 passed**, including intake persistence,
  canonical review links, domain authority, signature and decision, evidence
  revision/acceptance, desktop and mobile checks.
- Type checking and diff whitespace checks pass. Default lint exits successfully
  with zero errors and one warning in a generated coverage report asset.
- Relocated production-bundle checks pass for both AI runtimes, packaged policy
  reads and safe missing-asset failures, with network calls blocked.
- Separate private PostgreSQL suite: **9/9 passed**, exercising concurrent claims,
  late results, human changes and decisions through independent connections.
- Production dependency audit: **zero reported vulnerabilities**.

Main integration retained the numeric revision, evidence packet and database
attempt protocol, retiring the overlapping hash-token implementation. Review
also caught and fixed a timeout configuration that would have prevented retries
and a discard-edits path that needed to preserve explicit re-review. The browser
test now follows the refreshed-source acknowledgment and checks the exact packet
identity sent with the signature; the full rerun passed.

The suite retains its existing scoped React 418 allowance on one
submitted-detail reload, and the server logged a destination-stream-closed
warning during navigation. These results are not a blanket absence-of-errors
claim. Desktop and mobile evidence-review screenshots were also inspected.

## Where to make the next change

| Change | Primary owner |
| --- | --- |
| Intake answer shape or limits | `lib/intake/schema.ts` |
| Empty intake answers | `lib/intake/defaults.ts` |
| Legacy/current stored overlay interpretation | `lib/intake/stored-overlay.ts` |
| Deployment/control selection | `lib/deployments/selection.ts`, `lib/controls/current-revisions.ts` |
| Approval readiness | `lib/approval/review-readiness.ts` |
| Human review commands | `components/jeeves/review-workbench.tsx` |
| Review concurrency and result persistence | `lib/workflow/review-run.ts` |
| SDK/model selection and invocation estimates | `lib/agents/runtime.ts` |
| Shared fixture facts and identities | `lib/demo/reference-data.ts`, `lib/demo/personas.ts` |
| Read/write mode | `lib/data/provider-mode.ts` |

## Boundaries retained

Both SDKs, chat, governance domains and historical records remain. Removing a
supported capability is still a product choice. Execution is request-bound;
there is no durable background scheduler. Incident closure criteria were not
invented. Unknown overlay display remains a separate issue: the boolean policy
projection still treats unanswered flags as non-affirmative, and the existing
summary chips can display those as No. Deterministic triage rules did not change.

The existing browser suite already covered evidence upload, revision, acceptance
and blocked premature signing; the initial audit understated that coverage.
This pass extends the journey through a complete evidence-backed signature.

Local PGlite, mocked/intercepted SDK requests, browser checks and the separate
private Postgres concurrency suite do not establish hosted provider behavior or
production database readiness. The integration preserves main's existing
`0012_review_integrity.sql` migration prerequisite and adds no new migration.
No hosted migration or live provider call is part of this merge. The temporary
Postgres cluster used independent connections and was stopped after its tests.
