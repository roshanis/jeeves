# Meridian AI Policy — Procurement Domain, MP-P v2

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Procurement (assigned per initiative from the Procurement office;
Program Office contact Nia Okafor coordinates scheduling)
**Applies to:** All AI/ML initiatives that use a vendor-hosted or vendor-supplied model or
vendor-processed data (`vendor = Y`).

> Fictional internal policy corpus for the Jeeves demo. All section numbers, thresholds, and
> named artifacts are invented for Meridian Health. No real regulation or vendor-assessment
> standard is reproduced here.

## MP-P-1. Purpose and Scope

**MP-P-1.1** This policy governs third-party risk review for AI/ML vendors: contractual,
operational, and residency risk arising from sending Meridian data to an external model provider
or SaaS platform.

**MP-P-1.2** Procurement review applies whenever `vendor = Y` on the intake overlay flags,
regardless of tier. Non-vendor (self-hosted) initiatives are exempt from MP-P-2 and MP-P-3 but
remain subject to MP-P-5 if a vendor is later added.

## MP-P-2. Vendor Risk Assessment (control P-01)

**MP-P-2.1** Before any vendor-hosted model may be used with Meridian data of any kind, the
requester must complete a Vendor Risk Assessment (VRA) covering: financial stability, security
posture (informed by the Security domain's own assessment, MP-S), sub-processor chain, incident
history, and exit/portability plan.

**MP-P-2.2** The VRA is a gate control: no deployment may proceed to production until the VRA is
complete and filed as the VRA document artifact referenced in the effective-control record.

**MP-P-2.3** The VRA must be refreshed annually for as long as the vendor relationship continues,
and immediately upon a disclosed vendor security incident, ownership change, or sub-processor
addition.

**MP-P-2.4** For vendors processing PHI (in coordination with MP-H), the VRA must separately
score the vendor's Business Associate Agreement (BAA) readiness; a vendor unwilling to execute a
BAA fails the VRA outright.

## MP-P-3. SaaS Data-Residency Attestation (control P-02)

**MP-P-3.1** Where a vendor-hosted SaaS or model endpoint is used, the vendor must provide a
signed data-residency attestation specifying: the geographic region(s) where Meridian data is
stored and processed, whether data leaves that region for any processing step (including
sub-processors), and data-at-rest and in-transit encryption posture.

**MP-P-3.2** The attestation is a monitor control on an annual cadence; Procurement must confirm
it is current at each annual review and flag any drift from the originally attested regions.

**MP-P-3.3** An attestation that discloses processing outside a region Meridian has approved for
the applicable data class (e.g., PHI) is a finding that must be escalated to Legal (MP-L) and
Privacy (MP-H) jointly, not resolved by Procurement alone.

## MP-P-4. Champion-Class Review Criteria

**MP-P-4.1** For a vendor-hosted, PHI-touching, member-facing, coverage-influencing initiative,
the Procurement reviewer must confirm at minimum: (a) a current VRA scoring the vendor's PHI
handling and BAA readiness (MP-P-2.4), (b) a current data-residency attestation with no
undisclosed sub-processors touching PHI, (c) an exit/portability plan sufficient to migrate the
workload within Meridian's contractual notice period if the vendor's risk score degrades.

**MP-P-4.2** Because this profile is Critical tier, the reviewer must confirm the VRA and
attestation artifact versions referenced in the review match the deployment version under
review — not an earlier or later vendor agreement.

## MP-P-5. Grounds for Rejection

**MP-P-5.1** Procurement must recommend rejection where: (a) the vendor fails the VRA and no
compensating control (e.g., contractual indemnity, data-minimization redesign) is available;
(b) the vendor will not provide a data-residency attestation or discloses processing in a
jurisdiction inconsistent with Meridian's data-handling commitments; (c) the vendor's
sub-processor chain includes an entity that has separately failed a Meridian VRA.

**MP-P-5.2** A rejection under MP-P-5.1 must name the specific failed VRA criterion or
attestation gap in the decision record.

## MP-P-6. Re-Review Triggers

**MP-P-6.1** Re-review is required on: (a) VRA annual cadence (MP-P-2.3); (b) attestation annual
cadence (MP-P-3.2); (c) any material change to the vendor relationship — ownership change,
sub-processor addition, disclosed security incident, contract renegotiation; (d) tier increase
that adds PHI or care-coverage scope to a previously non-PHI vendor relationship.

**MP-P-6.2** "Material change" specifically includes the vendor's own AI model version change
where that change alters the vendor's data-retention or training-use terms — this must trigger
both a VRA refresh and coordination with MP-L-2.2 (addendum re-execution).

## MP-P-7. Returned Review Handling

**MP-P-7.1** A Procurement reviewer may return (rather than sign) a review when the VRA or
attestation is in progress but not yet complete; the returned review must specify which artifact
is outstanding and the vendor contact responsible for delivering it.

**MP-P-7.2** Procurement review may not be waived for a Critical-tier initiative; a "pending"
VRA blocks deployment regardless of urgency elsewhere in the review cycle (gate enforcement,
MP-P-2.2).

## MP-P-8. Evidence Retention

**MP-P-8.1** VRA and attestation artifacts must be retained for the life of the vendor
relationship plus one renewal cycle, and must be individually addressable by version so that an
audit query can reconstruct which artifact version was in force at the time of any given
decision (see plan.md §8 test 9 evidence-versioning requirement).
