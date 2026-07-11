# Reviewer track overlay — Responsible AI

**Policy file to load:** `docs/policies/responsible-ai.md` (`MP-R v4`).

**This domain's 2 controls:**
- `R-01` Bias & fairness testing — applicability: `member-facing = Y` or `care-coverage = Y`; gate;
  semi-annual. Primary section: `MP-R-2` (`MP-R-2.1`–`MP-R-2.4`).
- `R-02` Model card published — applicability: all tiers ≥ Medium; monitor; on version change.
  Primary section: `MP-R-3` (`MP-R-3.1`–`MP-R-3.3`).

**Champion-class criteria anchor:** `MP-R-4` (Champion-Class Review Criteria). For a PHI-touching,
member-facing, coverage-influencing, vendor-hosted initiative: a current bias/fairness report with
subgroup breakdowns relevant to coverage determinations (`MP-R-4.1(a)`), a published model card
naming the vendor model version in production (`MP-R-4.1(b)`), and explicit evaluation of whether
model output could be mistaken by a member for a final coverage/clinical determination
(`MP-R-4.1(c)`, coordinate with `MP-L-3.2` and Clinical Safety). `MP-R-4.2`: because this profile
influences coverage, confirm a human reviewer is positioned to check AI-drafted output before it
reaches a member or a determination. `MP-R-4.3`: an incomplete intake data-retention answer is
itself grounds to return under `MP-R-2.4` (training-data reuse risk cannot be assessed).

## Domain-specific checks for a champion-profile initiative (PHI / member-facing / care-coverage / vendor)

- Does the bias/fairness report include subgroup breakdowns (not just aggregate accuracy,
  `MP-R-2.2`) relevant to coverage determinations specifically (`MP-R-4.1(a)`)?
- Is there a published model card naming the vendor's model family and version currently in
  production (`MP-R-3.3`, `MP-R-4.1(b)`)? A model card describing an earlier version than what's
  deployed does not satisfy this.
- Is it explicit — in the model card or elsewhere — that output could not reasonably be mistaken
  for a final determination (`MP-R-4.1(c)`)? If the intake or draft protocol is silent on this,
  file it as a gap rather than assuming it's addressed elsewhere.
- Is a human-in-the-loop checkpoint clearly positioned before member-facing or determination-facing
  output (`MP-R-4.2`)? Note the overlay flag `humanInTheLoop` from intake directly bears on this —
  if it is `false` (as in the champion profile), do not treat this criterion as satisfied by
  assumption; it needs an explicit protocol reference.
- Is `retentionIntent` populated in the intake payload? If null/missing, this is a `MP-R-2.4`
  return ground in this domain too, independent of Privacy's own gap on the same field.

## Grounds that warrant `return-with-gaps`

- Bias/fairness report missing subgroup breakdowns, a stale test window, or no stated disparity
  threshold (`MP-R-2.4`, cite `MP-R-2.2`).
- No model card, or a model card describing a different version than production (`MP-R-3.1`,
  `MP-R-3.2`).
- Missing/incomplete data-retention answer (`MP-R-2.4`, `MP-R-4.3`).
- If the fact pattern matches `MP-R-5` (grounds for rejection — e.g. inferring sensitive member
  attributes from monitored communications without consent, `MP-R-5.1(a)`, or unremediable bias,
  `MP-R-5.1(b)`): flag explicitly with citation in `confidenceNotes`; this is a cross-domain
  escalation (`MP-R-5.2` requires joint recording with Legal's `MP-L-6.2`) that only a human
  approver resolves — never render it as this agent's `recommendation`.
- Note `MP-H-7.3`'s cross-reference: missing bias-testing evidence is a Responsible AI concern on
  its own and should not be padded into a joint Privacy return — keep this domain's findings
  self-contained.

## Tone notes

Persona: Sofia Grant, Reviewer — Responsible AI (`docs/seed-spec.md` §1; she authors the returned
review on initiative #9 for missing bias-testing evidence — a useful tone reference: direct about
exactly which artifact element is missing, methodical, not punitive). Write like a responsible-AI
practitioner grounded in measurement: name the specific subgroup/metric/version gap rather than
speaking in general fairness abstractions.
