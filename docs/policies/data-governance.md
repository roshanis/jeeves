# Meridian AI Policy — Data Governance Domain, MP-D v2

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Data Governance (Program Office coordination: Nia Okafor tracks
lineage and retention status across the pipeline; domain sign-off performed by the assigned
Data Governance reviewer)
**Applies to:** All AI/ML initiatives, Medium tier and above for lineage; PHI-touching
initiatives for retention/disposal.

> Fictional internal policy corpus for the Jeeves demo. All section numbers and artifact names
> are invented for Meridian Health.

## MP-D-1. Purpose and Scope

**MP-D-1.1** This policy governs data lineage, sourcing approval, and retention/disposal
practice for data used to build, evaluate, fine-tune, or operate an AI/ML initiative.

**MP-D-1.2** Data lineage & sourcing approval (MP-D-2) applies to all initiatives Medium tier
or above. Retention & disposal scheduling (MP-D-3) applies where `PHI = Y`.

## MP-D-2. Data Lineage & Sourcing Approval (control D-01)

**MP-D-2.1** Before production use, the requester must document the lineage of every data
source feeding the model: origin system, collection method, any prior processing or
transformation, and the approval basis for using that source for this purpose (member
agreement, internal data-use policy, or vendor contract terms).

**MP-D-2.2** This is a gate control, required once at initial approval and again on any material
change to the data sources used — a new source added, a source's collection method changed, or
a change in the approval basis for an existing source.

**MP-D-2.3** Lineage documentation must be sufficient for an auditor to trace a specific model
output or training example back to its originating record class without needing developer
interpretation — this is the evidentiary basis for the audit-query capability described in
plan.md §8 test 10.

**MP-D-2.4** Where a data source includes PHI, the lineage document must cross-reference the
DPIA (MP-H-2.1) covering that source; lineage approval does not substitute for Privacy's
independent sign-off.

## MP-D-3. Retention & Disposal Schedule (control D-02)

**MP-D-3.1** Where `PHI = Y`, the deployment owner must maintain a retention and disposal
schedule specifying, for each category of PHI used (intake data, model inputs, generated
outputs, logs), how long it is retained and the disposal method when the retention period
expires.

**MP-D-3.2** This is a monitor control on an annual cadence: the schedule must be reconfirmed
each year, and disposal actions taken under it must be logged as auditable events.

**MP-D-3.3** The retention schedule must be consistent with the intake's data-retention answer
and with any commitment made in the vendor's BAA (MP-H-2.2) or data-residency attestation
(MP-P-3.1); a mismatch between the schedule and either of those artifacts is a finding that
blocks sign-off until reconciled.

**MP-D-3.4** Where Legal has placed records under litigation hold (MP-L-5.1), the retention and
disposal schedule for the affected records is suspended for the duration of the hold; the
schedule document must note the suspension and its scope.

## MP-D-4. Champion-Class Review Criteria

**MP-D-4.1** For a PHI-touching, member-facing, coverage-influencing, vendor-hosted initiative,
the Data Governance reviewer must confirm at minimum: (a) complete lineage documentation for
every data source including any vendor-side fine-tuning or evaluation corpus, (b) that the
lineage document cross-references the DPIA covering PHI sources, (c) a retention/disposal
schedule consistent with the intake's data-retention answer, and (d) that the schedule is
consistent with the vendor's BAA and attestation terms.

**MP-D-4.2** Because a summarization model is likely to draw on structured claims and clinical
notes as well as free text, the reviewer must confirm lineage covers each distinct source type
separately rather than treating "clinical record system" as a single undifferentiated source.

## MP-D-5. Grounds for Rejection

**MP-D-5.1** Data Governance must recommend rejection or a blocking finding where: (a) a data
source's provenance cannot be established (unknown or undocumented origin); (b) a data source is
used without an approval basis and none can be retroactively established; (c) for a PHI-touching
initiative, no retention/disposal schedule can be produced and the gap cannot be remediated
before go-live.

**MP-D-5.2** Where a data source consists of scraped or monitored public/social member
communications used to build profiles without a documented collection approval, this is a
lineage-approval failure under MP-D-5.1(b) independent of, and in addition to, the Privacy and
Responsible AI grounds for rejecting the same fact pattern (MP-H-5.1(b), MP-R-5.1(a)).

## MP-D-6. Re-Review Triggers

**MP-D-6.1** Re-review is required: (a) MP-D-2 gate, once at approval and again on any material
change to data sources (MP-D-2.2); (b) MP-D-3 retention schedule, annual cadence for PHI-touching
initiatives (MP-D-3.2); (c) any litigation hold affecting scheduled disposal (MP-D-3.4);
(d) any change in vendor BAA or attestation terms that would make the existing schedule
inconsistent (MP-D-3.3).

**MP-D-6.2** A tier increase that adds PHI scope to a previously non-PHI initiative triggers an
immediate MP-D-3 schedule requirement where none previously existed.

## MP-D-7. Returned Review Handling

**MP-D-7.1** A Data Governance reviewer may return a review where lineage documentation is
substantially complete but missing one source's approval basis, or where a retention schedule
draft exists but has not been reconciled with the BAA/attestation terms; the returned review
must specify the exact gap.

**MP-D-7.2** An initiative with a retention/disposal schedule that has lapsed past its annual
cadence without renewal is "stale" for evidence-freshness reporting purposes and should be
flagged to the Program Office (Nia Okafor) for remediation-owner assignment even before a formal
re-review is scheduled.
