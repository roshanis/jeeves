# Meridian AI Policy — Legal Domain, MP-L v3

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Legal (James Liu)
**Applies to:** All AI/ML initiatives on the Meridian AI Governance Gateway ("Jeeves"), all tiers.

> This is a fictional internal policy corpus written for the Jeeves demo. All entities, section
> numbers, and citations are invented for Meridian Health, a fictional healthcare payer. Nothing
> in this document reproduces the text of any real statute or regulation.

## MP-L-1. Purpose and Scope

**MP-L-1.1** This policy governs legal review of AI/ML initiatives, including vendor contracting,
intellectual-property exposure, marketing and member-facing claims, and litigation-hold readiness
for AI-generated content.

**MP-L-1.2** Legal review is a required domain for every initiative regardless of tier; the
enforcement mode and cadence of individual controls vary by applicability as defined in the
control catalog (see MP-L-4 through MP-L-6).

## MP-L-2. Vendor Contract AI Addendum (control L-01)

**MP-L-2.1** Where an initiative uses a vendor-hosted or vendor-supplied model (`vendor = Y`), the
requester must obtain a signed Meridian AI Addendum from the vendor before any production use of
member or claims data, covering: data-use restrictions, model-training opt-out, sub-processor
disclosure, and incident-notification timelines.

**MP-L-2.2** The AI Addendum must be executed once per vendor relationship and re-executed on any
material change to the vendor's data-handling terms, sub-processor list, or model architecture
disclosed to Meridian.

**MP-L-2.3** Legal review under L-01 is not satisfied by a general master services agreement
alone; the AI-specific addendum is a distinct, separately signed artifact.

**MP-L-2.4** Absence of a signed addendum at the time of an architecture or privacy review is
grounds for that reviewer to return the initiative to the requester rather than sign (see MP-L-8).

## MP-L-3. Marketing and Member-Facing Claims Review (control L-02)

**MP-L-3.1** Where an initiative is member-facing (`member-facing = Y`), all outward-facing
copy, chat scripts, correspondence templates, or generated summaries that a member may read must
be reviewed against Meridian's fair-claims standard before first use and logged in the approved
copy log.

**MP-L-3.2** The fair-claims standard prohibits any AI-generated member-facing content that:
(a) implies a coverage or clinical determination has been made when it has not, (b) omits a
required appeal-rights notice, or (c) uses comparative or promissory language not reviewable
against a source-of-truth benefit document.

**MP-L-3.3** Marketing-claims review recurs on a quarterly cadence for the life of the deployment
(monitor enforcement), not only at launch, because prompts and generated copy can drift.

**MP-L-3.4** For care/coverage-influencing initiatives (`care-coverage = Y`), MP-L-3.2(a) applies
with heightened scrutiny: any generated text suggesting an outcome to a member before a licensed
reviewer's determination is a blocking defect, not a monitor-only finding.

## MP-L-4. Champion-Class Review Criteria (PHI, member-facing, care-coverage, vendor)

**MP-L-4.1** An initiative that is simultaneously PHI-touching, member-facing, coverage-influencing,
and vendor-hosted — the "champion" profile — requires the Legal reviewer to confirm, at minimum:
(a) a signed vendor AI Addendum (MP-L-2), (b) a fair-claims pass on all member-facing templates
(MP-L-3), (c) confirmation that vendor terms permit Meridian's specific PHI use case, and
(d) that no generated output purports to be a final coverage decision.

**MP-L-4.2** The Legal reviewer must additionally confirm that the intake record's data-retention
answer is complete before signing; an incomplete data-retention answer is a legal exposure
(unbounded retention terms) and blocks sign-off under MP-L-4.1, not merely a Privacy finding.

**MP-L-4.3** For Critical-tier initiatives, Legal sign-off must reference the specific vendor
addendum version and the specific fair-claims log entries reviewed, by ID, in the signed review.

## MP-L-5. Litigation Hold and Record Retention for AI Outputs

**MP-L-5.1** Legal may place any AI-generated correspondence or clinical-summary output under
litigation hold; once held, the deployment owner must suspend the retention/disposal schedule
under MP-D (Data Governance) for the affected records until the hold is lifted.

## MP-L-6. Grounds for Rejection

**MP-L-6.1** Legal review must recommend rejection (not conditional approval) where any of the
following is true: (a) the initiative processes member data for a purpose the member has not
been informed of and no lawful basis is documented; (b) the initiative would use member
communications or public/social postings in a manner inconsistent with Meridian's member
agreements and applicable privacy law; (c) no vendor addendum is obtainable because the vendor
will not agree to Meridian's data-use terms.

**MP-L-6.2** An initiative whose primary function is inferring member sentiment, behavior, or
characteristics from monitored member communications or public social activity without a
documented consent basis is presumptively inconsistent with MP-L-6.1(b) and must be escalated to
Legal and Responsible AI jointly before any further review proceeds.

**MP-L-6.3** A rejection under MP-L-6 must cite the specific sub-clause relied upon and be
recorded in the decision text in full, per plan record-keeping requirements.

## MP-L-7. Re-Review Triggers

**MP-L-7.1** Legal review must be repeated when any of the following occurs: (a) a material
change to the vendor contract, sub-processor list, or data-use terms; (b) a material change to
member-facing copy or correspondence templates outside the quarterly cadence; (c) a change in
the initiative's tier that adds member-facing or care-coverage scope; (d) at the periodic cadence
defined for the applicable control (L-02: quarterly monitor).

**MP-L-7.2** "Material change" for L-01 includes any renegotiation of the vendor's model-training
or sub-processor terms; for L-02 it includes a new correspondence template family not previously
logged.

## MP-L-8. Returned Review Handling

**MP-L-8.1** A Legal reviewer may return a review (rather than sign or reject) when required
evidence is missing but plausibly obtainable — e.g., an addendum in progress, a copy-log entry
not yet filed. The returned review must state the specific missing evidence and the section it
is required under.

**MP-L-8.2** A returned review re-enters the requester's queue and does not consume a new review
cycle for cycle-time reporting purposes until re-submitted.
