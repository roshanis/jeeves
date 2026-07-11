# Meridian AI Policy — Privacy/HIPAA Domain, MP-H v3

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Privacy/HIPAA (Marcus Webb)
**Applies to:** All AI/ML initiatives that touch protected health information (`PHI = Y`).

> Fictional internal policy corpus for the Jeeves demo. Meridian Health is a fictional payer.
> Concepts here are plausibly styled after generally known privacy/health-data governance
> practice (data minimization, de-identification, business-associate obligations) but are
> Meridian-invented; where a real legal regime would apply in practice, this corpus says "as
> required by applicable privacy law" rather than citing an actual statute or rule.

## MP-H-1. Purpose and Scope

**MP-H-1.1** This policy governs privacy and health-data protection review for AI/ML
initiatives: data minimization, business-associate obligations for vendors, and
de-identification validation for any initiative sending PHI to a vendor-hosted model.

**MP-H-1.2** PHI minimization & BAA (MP-H-2) applies to any initiative flagged `PHI = Y`.
De-identification validation (MP-H-3) applies where `PHI = Y` **and** `vendor = Y` — i.e., PHI is
being sent to a hosted model outside Meridian's own infrastructure.

## MP-H-2. PHI Minimization & Business Associate Agreement (control H-01)

**MP-H-2.1** Where `PHI = Y`, the requester must complete a Data Protection Impact Assessment
(DPIA) before production use, documenting: the minimum PHI fields necessary for the initiative's
function, the retention period for each field, downstream sharing (if any), and the lawful/
permitted basis for processing under Meridian's member agreements and applicable privacy law.

**MP-H-2.2** Where the PHI is processed by a vendor, a Business Associate Agreement (BAA) — or
Meridian's equivalent data-protection addendum for non-US vendors — must be executed before any
PHI is transmitted to that vendor. The DPIA and BAA together form the required evidence artifact
for this control.

**MP-H-2.3** This is a gate control, required once at initial approval and again on any material
change to the data used (a new PHI field added, a new downstream sharing arrangement, or a
change in retention terms).

**MP-H-2.4** Data minimization is not satisfied by "we only send what the vendor's API requires"
— the requester must affirmatively justify each PHI field's necessity to the initiative's stated
function. Fields includable "for future use" are not minimized and must be removed before
sign-off.

**MP-H-2.5** The intake's data-retention answer is a required input to the DPIA; an incomplete
or missing data-retention answer means the DPIA cannot be completed, and the Privacy reviewer
must return the review (MP-H-7) rather than sign, citing this section.

## MP-H-3. De-Identification Validation (control H-02)

**MP-H-3.1** Where `PHI = Y` and `vendor = Y`, before PHI-derived data is sent to the vendor
model in any form that is not fully identified and BAA-covered (e.g., a de-identified fine-tuning
or evaluation corpus), the requester must produce a de-identification validation report
demonstrating the re-identification risk is acceptably low by Meridian's validated statistical or
expert-determination method.

**MP-H-3.2** This is a gate control on an annual cadence: validation must be refreshed yearly for
as long as the de-identified data flow continues, because auxiliary data available to a vendor
can change and erode a prior validation's assumptions.

**MP-H-3.3** MP-H-3 does not replace MP-H-2's BAA requirement for any identified-PHI flow — an
initiative may need both a BAA (for identified PHI in normal operation) and a de-identification
validation (for any secondary use such as evaluation or fine-tuning on a de-identified extract).

## MP-H-4. Champion-Class Review Criteria

**MP-H-4.1** For a PHI-touching, member-facing, coverage-influencing, vendor-hosted initiative,
the Privacy reviewer must confirm at minimum: (a) a complete DPIA with field-level minimization
justification tied to the summarization function, (b) an executed BAA with the vendor covering
the specific PHI fields transmitted, (c) if any de-identified extract is used for evaluation or
tuning, a current de-identification validation report, (d) that the intake's data-retention
answer is present and consistent with the DPIA's stated retention period.

**MP-H-4.2** Because the initiative is member-facing, the reviewer must also confirm that no
PHI belonging to a member other than the one interacting with the system can appear in generated
output (cross-member leakage check) — this is a distinct check from de-identification validation
and must be evidenced in the DPIA's risk section.

**MP-H-4.3** Because the initiative influences coverage decisions, the reviewer must confirm the
DPIA addresses the risk of PHI-derived summaries being used as the sole basis for a determination
without human clinical review (coordinate with MP-C-2).

## MP-H-5. Grounds for Rejection

**MP-H-5.1** Privacy/HIPAA must recommend rejection where: (a) the vendor will not execute a BAA
or equivalent addendum and no alternative de-identification path is feasible; (b) the initiative's
function requires inferring or aggregating health-relevant signals from member communications or
public/social data without a documented consent basis — a use inconsistent with minimization and
with member expectations under Meridian's privacy notice; (c) the DPIA reveals PHI collection
materially broader than the stated function with no feasible minimization redesign.

**MP-H-5.2** A rejection under MP-H-5.1(b) must be recorded jointly with Responsible AI's
decision citing MP-R-5.1(a), and with Legal's decision citing MP-L-6.2 — this fact pattern
(inferring member health/behavior signals from monitored social or public communications) is the
canonical cross-domain rejection case in this policy corpus.

**MP-H-5.3** Rejection decision text must identify the specific DPIA section or missing artifact
relied upon.

## MP-H-6. Re-Review Triggers

**MP-H-6.1** Re-review is required: (a) MP-H-2 gate, once at approval and again on any material
data change (MP-H-2.3); (b) MP-H-3 de-identification validation, annual cadence where
applicable; (c) any vendor change (new sub-processor, new hosting region) affecting the PHI data
flow; (d) any disclosed vendor incident involving PHI exposure, which triggers immediate
re-review regardless of cadence.

**MP-H-6.2** "Material data change" includes: addition of a new PHI field to the model's input,
a change in retention period, a new downstream consumer of model output, or a change from
identified to de-identified data flow (or vice versa).

## MP-H-7. Returned Review Handling

**MP-H-7.1** A Privacy reviewer may return a review when the DPIA or BAA is in progress but
incomplete, or when the intake's data-retention answer is missing (MP-H-2.5); the returned
review must specify the exact missing element and cite the section requiring it.

**MP-H-7.2** A returned Privacy review on a Critical-tier initiative should be prioritized for
resubmission ahead of lower-tier queued reviews, consistent with the program office's cycle-time
goals, but this does not change the substantive bar for sign-off.

**MP-H-7.3** Missing bias-testing evidence alone is a Responsible AI concern (MP-R-2.4) and does
not by itself justify a Privacy return; the two domains review independently even when a single
initiative is deficient in both.
