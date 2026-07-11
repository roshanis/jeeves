# Meridian AI Policy — Clinical Safety Domain, MP-C v3

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Clinical Safety (Dr. Elena Vasquez)
**Applies to:** All AI/ML initiatives that influence a care or coverage determination
(`care-coverage = Y`).

> Fictional internal policy corpus for the Jeeves demo. Meridian Health is a fictional payer;
> clinical-safety concepts here are Meridian-invented and do not reproduce any real clinical
> practice guideline or regulation.

## MP-C-1. Purpose and Scope

**MP-C-1.1** This policy governs clinical-safety review of AI/ML initiatives whose output can
influence a care or coverage decision: prior-authorization support, correspondence drafting,
triage summarization, and similar clinically adjacent functions.

**MP-C-1.2** Both controls in this domain apply where `care-coverage = Y`, regardless of tier
derivation from other flags, because any care/coverage influence independently drives the tier
to Critical per the triage rules.

## MP-C-2. Clinician-in-the-Loop Protocol (control C-01)

**MP-C-2.1** Before production deployment, the requester must document and the Clinical Safety
reviewer must sign a clinician-in-the-loop protocol specifying: which AI-generated outputs a
licensed clinical reviewer must check before any coverage or care action is taken, the maximum
proportion of outputs that may bypass human review (if any), and the escalation path when a
clinician disagrees with or flags an AI-generated output.

**MP-C-2.2** This is a gate control, required once before initial deployment. It is not
satisfied by a general "human oversight" statement; the protocol must name the specific
review checkpoint(s) in the workflow and the role responsible (e.g., "utilization-management
nurse reviews and signs every AI-drafted prior-authorization summary before it reaches the
determination step").

**MP-C-2.3** No AI-generated output under this policy may itself constitute a final coverage or
clinical determination; the protocol must make explicit that the AI output is a draft or
decision-support artifact only, and the human reviewer's sign-off is the operative act.

**MP-C-2.4** Where a conditional approval imposes a human-review sampling rate as a condition
(see MP-C-4.2), that sampling rate is part of the clinician-in-the-loop protocol and must be
re-attested at the cadence specified in the condition, not left informal.

## MP-C-3. Adverse-Event Monitoring (control C-02)

**MP-C-3.1** For any care/coverage-influencing initiative in production, the deployment owner
must maintain continuous adverse-event monitoring: a mechanism for clinicians, members, or staff
to report a suspected harm or near-miss traceable to an AI-generated output, and a log of all
such reports.

**MP-C-3.2** This is a monitor control with continuous cadence — there is no periodic "refresh";
the incident log must be live and reviewed on an ongoing basis by Clinical Safety.

**MP-C-3.3** Any adverse-event report rated as a plausible patient-safety or coverage-harm
event must trigger an immediate reassessment review cycle for the initiative (see MP-C-6),
independent of and in addition to any eval-quality (Q-01) breach handling.

## MP-C-4. Champion-Class Review Criteria

**MP-C-4.1** For a PHI-touching, member-facing, coverage-influencing, vendor-hosted initiative
(the prior-authorization clinical-summarizer profile), the Clinical Safety reviewer must confirm
at minimum: (a) a signed clinician-in-the-loop protocol naming the exact checkpoint at which a
licensed reviewer checks the AI-drafted summary before any coverage step, (b) that the protocol
explicitly disclaims the AI output as non-final (MP-C-2.3), (c) an adverse-event reporting
channel live before go-live, (d) escalation-protocol clarity sufficient for frontline staff to
use without clinical-safety office involvement in the moment.

**MP-C-4.2** A **conditional approval** for this profile may impose conditions such as: a
minimum human-review sampling rate above the protocol's baseline, and a defined escalation
protocol refinement, each linked to controls C-01/C-02. Conditions must specify a review-by date
and the evidence that will satisfy them; an approval with open conditions is not equivalent to an
unconditional approval and must be tracked to closure.

**MP-C-4.3** The reviewer must confirm the eval-quality threshold (Q-01) applicable to this
initiative's tier (Critical default 0.05, per the control catalog) is wired to the deployment's
pause mechanism (coordinate with MP-T-4.2), since clinical safety depends on the automated
breach response actually reaching a human.

## MP-C-5. Grounds for Rejection

**MP-C-5.1** Clinical Safety must recommend rejection or a blocking finding where: (a) no
clinician-in-the-loop checkpoint is proposed for an initiative that could plausibly influence a
determination without one; (b) the requester proposes to let AI output stand as a final
determination without human sign-off; (c) no adverse-event reporting mechanism can be
operationalized before go-live for a Critical-tier initiative.

**MP-C-5.2** Where rejection is not warranted but material gaps remain, Clinical Safety should
prefer a **conditional approval** with tracked conditions (MP-C-4.2) over an outright rejection,
provided the core clinician-in-the-loop checkpoint (MP-C-2.3) is present — full rejection is
reserved for the absence of any human check, not for incremental sampling-rate or protocol
refinements.

## MP-C-6. Re-Review Triggers

**MP-C-6.1** Re-review is required: (a) once at initial approval (gate, MP-C-2.2); (b) on any
adverse-event report rated plausible patient-safety or coverage-harm (immediate, MP-C-3.3); (c)
on any material change to the clinician-in-the-loop checkpoint (removal, relocation in the
workflow, or a change to the human-review sampling rate); (d) at the review-by date attached to
any open condition from a conditional approval (MP-C-4.2).

**MP-C-6.2** A version promotion of the underlying model (e.g., a checkpoint update pending
feedback-provenance sign-off) requires Clinical Safety to reconfirm the clinician-in-the-loop
protocol still matches the new version's output characteristics before the new version serves
production coverage-influencing traffic.

## MP-C-7. Returned Review Handling

**MP-C-7.1** A Clinical Safety reviewer may return a review when the clinician-in-the-loop
protocol is drafted but not yet signed by the accountable clinical owner, or when the
adverse-event channel is built but not yet tested; the returned review must specify which
element is outstanding.

**MP-C-7.2** A returned Clinical Safety review on a Critical-tier initiative blocks the overall
review cycle from reaching a decision, since Clinical Safety sign-off is required for every
care/coverage-influencing initiative regardless of how many other domains have signed.
