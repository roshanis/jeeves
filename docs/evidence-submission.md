# Evidence submission (fictional demo)

The initiative Evidence tab supports PDF/DOCX uploads, a reusable document library, saved requirement bindings, immutable submission snapshots, reviewer feedback and revised submissions. The applicable control catalog and active review cycle determine the checklist. One document may satisfy several requirements, each with its own page reference and explanatory note.

## Operating boundary

Upload fictional Meridian Health documents only. Documents are **not malware scanned**. Format checks are not malware protection. There is no inline rendering, OCR or text extraction, and document contents are never sent to an LLM. Requester notes, page references and file names are included in AI review drafts. Downloads are authenticated attachment responses with no-store and nosniff headers. Real company/health documents require production identity and document access controls, a configured malware scanner with fail-closed quarantine, and retention/erasure policy before this feature can serve them.

For this small demo, private PostgreSQL BYTEA storage keeps document bytes and audit records under the existing database transaction and backup boundary. No public file URL or external storage account is introduced. Files are capped at 2 MiB, initiatives at 20 MiB or 40 immutable versions, and cycles at 100 packets. In the demo, one workspace is also capped at 100 MiB of evidence and the whole database at 2 GiB (`JEEVES_EVIDENCE_WORKSPACE_MAX_MIB`, `JEEVES_EVIDENCE_TOTAL_MAX_MIB`); an upload past either ceiling is refused with `413` and a message saying which one. Production has no default ceiling. Larger deployments should use private object storage behind the same authorization boundary. Live Neon upload/download has not been verified by the local PGlite tests.

## Workflow

1. Create an initiative in your own demo workspace (Start demo; you start as the requester, no passcode). Shared seeded initiatives do not accept uploads.
2. Upload a document. It is saved privately, not submitted or accepted. Select "New version of" to preserve lineage when revising a document.
3. Complete intake and triage to establish the checklist. Link uploaded documents to requirements, add page references/notes and save a draft or submit.
4. The assigned domain reviewer downloads the original and records acceptance or requested changes with a reason. Admin cannot assess evidence. All authenticated personas in the same initiative workspace may view the shared dossier; only the owning requester can edit it.
5. The requester supplies a revision and resubmits. Older file versions, submissions and assessments remain accessible. Unchanged bindings may carry forward an earlier assessment; its original identity is retained.
6. Once a cycle has an evidence packet, domain signature requires every applicable requirement to have accepted evidence and no differing unsent draft. Signature audit metadata pins the packet, documents and assessments. Existing no-packet reviews retain their prior behavior. Evidence acceptance never signs a review or approves an initiative.

Uploads retain their retry identity after a lost response. An uncertain submission locks edits until reconciliation and retries the same saved packet. Sign-in attempts and authenticated actions now use separate persisted rate-limit buckets with their existing limits unchanged.

## Evidence-led review workbench

Open a domain review from **Reviews** to work across three panels: evidence sources, the selected source, and your assessment. The source panel displays the exact submitted document version, requester-supplied page reference and note, authenticated download, and the assigned reviewer's acceptance or change request. These notes are not extracted document contents. AI drafts are expandable aids; the human assessment and domain signature remain separate from evidence acceptance.

Source switching preserves human edits. Edits are scoped to the session, initiative, domain and review cycle. A newer cycle blocks actions and hides mismatched evidence until refresh. Missing or unaccepted requirements and unsent revisions block signing once evidence packets exist; existing no-packet reviews keep their prior contract. If evidence cannot load, **Open initiative reviews** returns to the existing domain review surface, whose API still enforces all signature requirements.

Arize evaluations and W&B training provenance appear as **Not connected** sources. No external results, lineage, live integration, policy text, inline document rendering or new document processing is supplied by this layout.

## Deployment

Evidence upload is a demo-playground feature. A production install (`JEEVES_MODE` unset) closes every demo door, and customer sign-in is not built yet, so nobody can reach evidence there until it is. A demo install with a database offers passwordless entry, so any visitor can upload: keep to fictional documents.

Storage ceilings are checked inside the upload transaction under one advisory lock, so two concurrent uploads cannot both pass; the check sums `evidence_documents.byte_size` (joined to `initiatives` for the workspace sum), which is fine at demo volume. A ceiling set to a malformed value never means unlimited: the demo falls back to its default, and a production install with a malformed `JEEVES_EVIDENCE_WORKSPACE_MAX_MIB` pauses its uploads with `503` until the value is fixed (the total variable is ignored in production). An upload that waits more than 10 seconds for the lock answers `503` "busy" with a `Retry-After: 5` header. When the demo's total ceiling is reached, uploads stay refused until space is freed or the ceiling is raised; the rows are immutable, so freeing space needs a separately authorized maintenance procedure, which this repository does not provide.

Apply migration `0011_evidence_submission.sql` using the existing `npm run db:migrate` path against the intended database before enabling this release. Do not use `db:seed` to migrate an existing database. The migration is additive and introduces immutable document/assessment records and immutable submitted packets. If application rollback is necessary, deploy the previous application version and retain the new tables and history; do not drop evidence tables.

Existing seed/reset commands do not erase evidence history. Their destructive reset will fail safely on a database containing evidence, so use a fresh disposable database for a clean demo. File retention and purge require a separately authorized maintenance procedure.

Tests cover the real migrations in isolated PGlite, service and HTTP authorization, size/format boundaries, retries, stale revisions, carry-forward, immutable records, signature requirements and a browser upload/return/revise/accept/download journey. Live database migration and hosted byte transport must be checked separately.

A rolling deployment before migration does not break legacy domain signatures: a schema-presence check retains the prior no-evidence behavior only while the evidence table is absent. Evidence requests fail closed until migration. After the table exists, all evidence checks apply and database errors cannot bypass them.

The production dependency audit was clean when this release shipped; the development tree still reported moderate advisories in Vitest/Drizzle tooling with no compatible resolution. No forced downgrade or major toolchain change was made. Check `package.json` for current versions.
