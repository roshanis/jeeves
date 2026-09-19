# Evidence submission (fictional demo)

The initiative Evidence tab supports PDF/DOCX uploads, a reusable document library, saved requirement bindings, immutable submission snapshots, reviewer feedback and revised submissions. The applicable control catalog and active review cycle determine the checklist. One document may satisfy several requirements, each with its own page reference and explanatory note.

## Operating boundary

Upload fictional Meridian Health documents only. Documents are **not malware scanned**. Format checks are not malware protection. There is no inline rendering, OCR, text extraction or LLM processing. Downloads are authenticated attachment responses with no-store and nosniff headers. Real company/health documents require production identity and document access controls, a configured malware scanner with fail-closed quarantine, and retention/erasure policy before this feature can serve them.

For this small demo, private PostgreSQL BYTEA storage keeps document bytes and audit records under the existing database transaction and backup boundary. No public file URL or external storage account is introduced. Files are capped at 2 MiB, initiatives at 20 MiB or 40 immutable versions, and cycles at 100 packets. Larger deployments should use private object storage behind the same authorization boundary. Live Neon upload/download has not been verified by the local PGlite tests.

## Workflow

1. Create an initiative in a passcode-gated workspace. Shared seeded initiatives do not accept uploads.
2. Upload a document. It is saved privately, not submitted or accepted. Select "New version of" to preserve lineage when revising a document.
3. Complete intake and triage to establish the checklist. Link uploaded documents to requirements, add page references/notes and save a draft or submit.
4. The assigned domain reviewer downloads the original and records acceptance or requested changes with a reason. Admin cannot assess evidence. All authenticated personas in the same initiative workspace may view the shared dossier; only the owning requester can edit it.
5. The requester supplies a revision and resubmits. Older file versions, submissions and assessments remain accessible. Unchanged bindings may carry forward an earlier assessment; its original identity is retained.
6. Once a cycle has an evidence packet, domain signature requires every applicable requirement to have accepted evidence and no differing unsent draft. Signature audit metadata pins the packet, documents and assessments. Existing no-packet reviews retain their prior behavior. Evidence acceptance never signs a review or approves an initiative.

Uploads retain their retry identity after a lost response. An uncertain submission locks edits until reconciliation and retries the same saved packet. Sign-in attempts and authenticated actions now use separate persisted rate-limit buckets with their existing limits unchanged.

## Deployment

Apply migration `0011_evidence_submission.sql` using the existing `npm run db:migrate` path against the intended database before enabling this release. Do not use `db:seed` to migrate an existing database. The migration is additive and introduces immutable document/assessment records and immutable submitted packets. If application rollback is necessary, deploy the previous application version and retain the new tables and history; do not drop evidence tables.

Existing seed/reset commands do not erase evidence history. Their destructive reset will fail safely on a database containing evidence, so use a fresh disposable database for a clean demo. File retention and purge require a separately authorized maintenance procedure.

Tests cover the real migrations in isolated PGlite, service and HTTP authorization, size/format boundaries, retries, stale revisions, carry-forward, immutable records, signature requirements and a browser upload/return/revise/accept/download journey. Live database migration and hosted byte transport must be checked separately.

A rolling deployment before migration does not break legacy domain signatures: a schema-presence check retains the prior no-evidence behavior only while the evidence table is absent. Evidence requests fail closed until migration. After the table exists, all evidence checks apply and database errors cannot bypass them.

The release also updates Next.js and its matching ESLint package to 16.3.5 and refreshes compatible transitive dependencies. The production dependency audit is clean; the development tree still reports moderate advisories in Vitest/Drizzle tooling with no compatible resolution obtained in this release. No forced downgrade or major toolchain change was made.
