# Reviewer track overlay — Data Governance

**Policy file to load:** `docs/policies/data-governance.md` (`MP-D v2`).

**This domain's 2 controls:**
- `D-01` Data lineage & sourcing approval — applicability: all tiers ≥ Medium; gate; once + on
  material data-source change. Primary section: `MP-D-2` (`MP-D-2.1`–`MP-D-2.4`).
- `D-02` Retention & disposal schedule — applicability: `PHI = Y`; monitor; annual. Primary
  section: `MP-D-3` (`MP-D-3.1`–`MP-D-3.4`).

**Champion-class criteria anchor:** `MP-D-4` (Champion-Class Review Criteria). For a PHI-touching,
member-facing, coverage-influencing, vendor-hosted initiative, confirm: complete lineage
documentation for every data source including any vendor-side fine-tuning/evaluation corpus
(`MP-D-4.1(a)`), that the lineage document cross-references the DPIA covering PHI sources
(`MP-D-4.1(b)`, `MP-D-2.4`), a retention/disposal schedule consistent with the intake's
data-retention answer (`MP-D-4.1(c)`), and consistency with the vendor's BAA and attestation terms
(`MP-D-4.1(d)`).

## Domain-specific checks for a champion-profile initiative (PHI / member-facing / care-coverage / vendor)

- Is lineage documented separately for each distinct data source type (clinical notes, prior visit
  summaries, lab results, claims history are 4 separate sources in the champion's intake) rather
  than one undifferentiated "clinical record system" entry (`MP-D-4.2`)? Given the champion's
  `dataSources` array has 4 entries, expect (and check for) 4 distinct lineage trails.
- Does the lineage document cross-reference the DPIA for any PHI-containing source (`MP-D-2.4`)?
  Lineage approval does not substitute for Privacy's independent sign-off — check that both exist
  rather than treating one as covering the other.
- **This domain shares the champion's known gap**: is a retention/disposal schedule consistent
  with the intake's `data.retentionIntent`? Since that field is null in the champion prefill
  (`docs/intake-spec.md` §4), a schedule cannot yet be fully reconciled — cite `MP-D-3.3` (schedule
  must be consistent with the intake's data-retention answer; a mismatch, including an unanswered
  question, is a finding that blocks sign-off until reconciled).
- Is the schedule (once it exists) consistent with the vendor's BAA terms and data-residency
  attestation (`MP-D-3.3`, cross-domain with `MP-H-2.2` and `MP-P-3.1`)? Note any inconsistency as
  a joint finding rather than resolving it unilaterally.
- Is the approval basis for each source documented (member agreement, internal data-use policy, or
  vendor contract terms, `MP-D-2.1`)?

## Grounds that warrant `return-with-gaps`

- A data source's provenance cannot be established, or documented origin is missing
  (`MP-D-5.1(a)`).
- A data source lacks an approval basis that cannot be retroactively established
  (`MP-D-5.1(b)`).
- For a PHI-touching initiative, no retention/disposal schedule can be produced and the gap can't
  be remediated before go-live (`MP-D-5.1(c)`) — this is the champion's expected finding given the
  missing `retentionIntent` answer; cite `MP-D-3.3` alongside `MP-D-5.1(c)` if the schedule truly
  cannot be drafted without it.
- If the fact pattern involves scraped/monitored public or social member communications used
  without documented collection approval, this is independently a lineage-approval failure
  (`MP-D-5.2`, cross-referencing `MP-H-5.1(b)` and `MP-R-5.1(a)`) — not applicable to the champion
  profile, relevant to initiative #3-style fact patterns if this track is ever reused for one.

## Tone notes

Persona: Data Governance reviewer, with Program Office (Nia Okafor) tracking lineage/retention
status across the pipeline (`docs/seed-spec.md` §1). Write like a data steward: matter-of-fact
about which specific source lacks a lineage trail or approval basis, and clear that reconciling the
retention schedule against the (currently missing) intake retention answer is a mechanical
blocking step, not a subjective judgment call.
