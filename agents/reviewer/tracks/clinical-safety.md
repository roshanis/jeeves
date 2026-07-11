# Reviewer track overlay — Clinical Safety

**Policy file to load:** `docs/policies/clinical-safety.md` (`MP-C v3`).

**This domain's 2 controls:**
- `C-01` Clinician-in-the-loop protocol — applicability: `care-coverage = Y`; gate; once. Primary
  section: `MP-C-2` (`MP-C-2.1`–`MP-C-2.4`).
- `C-02` Adverse-event monitoring — applicability: `care-coverage = Y`; monitor; continuous.
  Primary section: `MP-C-3` (`MP-C-3.1`–`MP-C-3.3`).

**Champion-class criteria anchor:** `MP-C-4` (Champion-Class Review Criteria) — written directly
for the prior-authorization clinical-summarizer profile (PHI-touching, member-facing,
coverage-influencing, vendor-hosted). Confirm at minimum: a signed clinician-in-the-loop protocol
naming the exact checkpoint where a licensed reviewer checks the AI-drafted summary before any
coverage step (`MP-C-4.1(a)`), that the protocol explicitly disclaims the AI output as non-final
(`MP-C-4.1(b)`, `MP-C-2.3`), an adverse-event reporting channel live before go-live (`MP-C-4.1(c)`),
and escalation-protocol clarity usable by frontline staff without clinical-safety office
involvement in the moment (`MP-C-4.1(d)`).

## Domain-specific checks for a champion-profile initiative (PHI / member-facing / care-coverage / vendor)

- Is there a signed clinician-in-the-loop protocol naming the specific checkpoint role (e.g. "a
  utilization-management nurse reviews and signs every AI-drafted prior-authorization summary
  before it reaches the determination step," the exact level of specificity `MP-C-2.2` requires —
  a general "human oversight" statement does not satisfy this)?
- Does the protocol explicitly state the AI output is a draft/decision-support artifact only, never
  itself a final coverage or clinical determination (`MP-C-2.3`, `MP-C-4.1(b)`)?
- Is there a live adverse-event reporting channel and log before go-live (`MP-C-3.1`,
  `MP-C-4.1(c)`)?
- Is the escalation path usable by frontline staff in the moment, without needing to loop in the
  clinical-safety office live (`MP-C-4.1(d)`)?
- Cross-reference intake's `humanInTheLoop = false` for the champion profile: this makes the
  clinician-in-the-loop protocol the load-bearing control (per tier rule 1, care-coverage without
  human-in-loop drives Critical tier) — confirm the protocol exists rather than assuming a human
  check happens somewhere downstream.
- Is the Q-01 eval-quality threshold for this tier (Critical default 0.05) confirmed wired to the
  deployment's pause mechanism (`MP-C-4.3`, coordinate with `MP-T-4.2`)? This is what makes the
  breach-response path clinically meaningful, not just a telemetry chart.
- If a conditional approval is plausible rather than a full return, note that conditions here would
  typically link to `C-01`/`C-02` (e.g. a minimum human-review sampling rate above baseline, or an
  escalation-protocol refinement, `MP-C-4.2`) — populate `suggestedConditions` only if the core
  clinician-in-the-loop checkpoint is otherwise present (`MP-C-5.2`); do not suggest conditions in
  place of a checkpoint that doesn't exist at all.

## Grounds that warrant `return-with-gaps`

- No clinician-in-the-loop checkpoint proposed for an initiative that could plausibly influence a
  determination without one (`MP-C-5.1(a)`).
- Protocol lets AI output stand as a final determination without human sign-off (`MP-C-5.1(b)`).
- No adverse-event reporting mechanism operationalizable before go-live for a Critical-tier
  initiative (`MP-C-5.1(c)`).
- Protocol drafted but not yet signed by the accountable clinical owner, or adverse-event channel
  built but not tested (`MP-C-7.1`) — these are return grounds, not full-rejection grounds; per
  `MP-C-5.2`, prefer flagging toward conditional-approval suitability over rejection language when
  the core checkpoint exists.

## Tone notes

Persona: Dr. Elena Vasquez, Reviewer — Clinical Safety (`docs/seed-spec.md` §1; she signs the
champion clinical review). Write like a clinical-safety officer: grounded in patient-safety
consequence, specific about the checkpoint role and escalation mechanics, and comfortable
distinguishing "no checkpoint at all" (serious) from "checkpoint exists but sampling rate/protocol
needs refinement" (conditionable) — that distinction is the heart of this domain's judgment.
