# Meridian AI Policy — Responsible AI Domain, MP-R v4

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Responsible AI (Sofia Grant)
**Applies to:** All AI/ML initiatives; bias/fairness testing applies specifically where
member-facing or care/coverage-influencing.

> Fictional internal policy corpus for the Jeeves demo, styled loosely after public AI
> risk-management framing (e.g., govern/map/measure/manage categories) but entirely
> Meridian-specific. No real framework or regulation text is reproduced.

## MP-R-1. Purpose and Scope

**MP-R-1.1** This policy governs responsible-AI review: bias and fairness, transparency
(model cards), and appropriate-use boundaries for AI/ML initiatives at Meridian Health.

**MP-R-1.2** Bias and fairness testing (MP-R-2) applies to any initiative flagged
member-facing or care/coverage-influencing on intake. Model-card publication (MP-R-3) applies
to all initiatives Medium tier or above.

## MP-R-2. Bias & Fairness Testing (control R-01)

**MP-R-2.1** Where `member-facing = Y` or `care-coverage = Y`, the requester must produce a
bias and fairness test report before production deployment, evaluating model outputs across
protected and Meridian-relevant member subgroups relevant to the initiative's function (e.g.,
language preference, plan type, geography) for disparate error rates or disparate outcomes.

**MP-R-2.2** The test report must state the subgroup definitions used, the metric(s) evaluated,
the disparity threshold applied, and pass/fail determination per subgroup. A report that
evaluates only aggregate accuracy without subgroup breakdown does not satisfy MP-R-2.1.

**MP-R-2.3** This is a gate control on a semi-annual cadence: it must pass before initial
deployment and be refreshed at least every six months for as long as the deployment operates,
because prompt, retrieval, or fine-tuning changes can silently reintroduce disparity.

**MP-R-2.4** A review may be **returned** (not signed, not rejected) under this section when
the requester has submitted a report that is incomplete or methodologically insufficient — for
example, missing subgroup breakdowns, a stale test window, or no stated disparity threshold.
The returned review must cite MP-R-2.2 and specify exactly which element is missing.

## MP-R-3. Model Card Publication (control R-02)

**MP-R-3.1** For all initiatives Medium tier or above, the requester must publish a model card
covering: intended use, known limitations, training/fine-tuning data provenance (at a summary
level; detailed lineage lives under MP-D), and evaluation summary.

**MP-R-3.2** This is a monitor control triggered on every version change: a new model version
requires a new or updated model card before that version serves production traffic.

**MP-R-3.3** The model card must disclose whether the underlying model is vendor-hosted and, if
so, name the vendor's model family and version at a level sufficient for a reviewer to assess
whether MP-R-2 testing remains valid across the version boundary.

## MP-R-4. Champion-Class Review Criteria

**MP-R-4.1** For a PHI-touching, member-facing, coverage-influencing, vendor-hosted initiative,
the Responsible AI reviewer must confirm at minimum: (a) a current bias/fairness report with
subgroup breakdowns relevant to coverage determinations, (b) a published model card naming the
vendor model version in production, (c) explicit evaluation of whether the model's output could
be mistaken by a member for a final coverage or clinical determination (coordinate with MP-L-3.2
and MP-C).

**MP-R-4.2** Because this profile influences coverage, the reviewer must additionally confirm
that a human reviewer is positioned to check AI-drafted output before it reaches a member or
influences a determination (human-in-the-loop condition; coordinate with MP-C-2).

**MP-R-4.3** The reviewer must confirm the intake's data-retention answer is not blank; an
incomplete data-retention answer prevents the reviewer from assessing training-data reuse risk
and is grounds to return the review under MP-R-2.4 pending completion, or to escalate to Privacy
if the gap persists past one review cycle.

## MP-R-5. Grounds for Rejection

**MP-R-5.1** Responsible AI must recommend rejection where: (a) the initiative's core function
is to infer sensitive member attributes (health status, likely diagnoses, behavior patterns)
from monitored public or social communications without member consent — this is a surveillance
use case inconsistent with Meridian's responsible-use boundary regardless of mitigation offered;
(b) bias testing reveals a disparity that cannot be remediated within the initiative's design
(e.g., a structurally biased data source with no viable subgroup correction); (c) the requester
cannot produce any bias/fairness evidence and the initiative is Critical tier.

**MP-R-5.2** A rejection under MP-R-5.1(a) must be recorded jointly with the Legal decision
citing MP-L-6.2, since both domains treat unconsented inference from monitored communications as
independently disqualifying.

**MP-R-5.3** Rejection decisions under this section must name the specific evidence reviewed
(or the specific absence of evidence) and may not rely on generalized risk aversion alone.

## MP-R-6. Re-Review Triggers

**MP-R-6.1** Re-review is required: (a) at the semi-annual cadence for bias/fairness testing
(MP-R-2.3); (b) on every model version change (model card, MP-R-3.2, and a fresh bias check if
the version change alters the underlying model family); (c) on any material change to the
initiative's member-facing surface or the population it serves; (d) on tier increase adding
member-facing or care-coverage scope.

**MP-R-6.2** "Material change" for MP-R-2 specifically includes a change to the prompt template,
retrieval corpus, or fine-tuning data that could plausibly shift subgroup performance, even
absent a formal model-version bump.

## MP-R-7. Returned Review Handling

**MP-R-7.1** A returned Responsible AI review (see MP-R-2.4) must specify the missing evidence
element, cite the section violated, and be addressed to the requester with enough detail that
resubmission does not require a second round of clarifying questions.

**MP-R-7.2** A returned review does not advance the initiative's stage; the initiative remains
"in review" for that domain until re-signed or escalated to rejection under MP-R-5.
