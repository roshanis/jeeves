# Reviewer track overlay — Tech Architecture

**Policy file to load:** `docs/policies/tech-architecture.md` (`MP-T v2`).

**This domain's 2 controls:**
- `T-01` Architecture review record — applicability: all tiers ≥ Medium; gate; once + on material
  change. Primary section: `MP-T-2` (`MP-T-2.1`–`MP-T-2.4`).
- `T-02` Disaster-recovery plan — applicability: tier ≥ High; monitor; annual. Primary section:
  `MP-T-3` (`MP-T-3.1`–`MP-T-3.3`).

**Champion-class criteria anchor:** `MP-T-4` (Champion-Class Review Criteria). For a Critical-tier,
vendor-hosted, coverage-influencing initiative: documented data flow showing where PHI enters/exits
the model invocation path (`MP-T-4.1(a)`), a synchronous or bounded-latency invocation pattern
suitable for a human-in-the-loop step (`MP-T-4.1(b)`, coordinate with Clinical Safety), a working
pause/resume mechanism reachable by an Admin action without a code deploy (`MP-T-4.1(c)`), and a DR
plan covering vendor outage (`MP-T-4.1(d)`). `MP-T-4.2`: all Critical-tier initiatives must expose
operator-controlled pause/resume — this is the architectural precondition for the eval-quality
control (Q-01) to be enforceable.

## Domain-specific checks for a champion-profile initiative (PHI / member-facing / care-coverage / vendor)

- Is the PHI data flow fully documented end to end (entry, transformation, exit at the vendor call
  boundary, per `MP-T-2.1`)? An opaque or partially-documented integration path is a gap even if
  ARB minutes exist for the rest of the system.
- Is the invocation pattern bounded-latency/synchronous enough to support a human-in-the-loop
  checkpoint before output reaches a coverage step (`MP-T-4.1(b)`)? This is a coordination point
  with Clinical Safety (`MP-C-2`) — flag it as a cross-domain dependency if unclear rather than
  guessing at the clinical workflow.
- Does an Admin-reachable pause/resume mechanism exist and does it not require a code deployment
  (`MP-T-4.1(c)`, `MP-T-2.4` — exercised in non-production before go-live)?
- Does the DR plan explicitly address vendor outage as a distinct failure mode from Meridian
  infrastructure failure, with a stated maximum degraded-service window (`MP-T-3.3`)?
- `MP-T-4.3`: confirm state transitions are recorded in Meridian application code / system of
  record, not inside the agent/workflow adapter — this is a standing architectural requirement,
  not something this review can affirmatively verify from intake alone; note it as a
  confidence-note check for the human reviewer rather than asserting compliance.

## Grounds that warrant `return-with-gaps`

- No pause/resume mechanism for a High-tier-or-above initiative (`MP-T-5.1(a)`).
- Data flow cannot be fully traced — an opaque/undocumented integration path touching PHI or
  claims data (`MP-T-5.1(b)`).
- DR plan absent for a Critical-tier initiative with no compensating control (`MP-T-5.1(c)`).
- Architecture appears to store decision/approval state exclusively outside the system of record
  (`MP-T-5.1(d)`, `MP-T-4.3`) — treat this as a serious flag requiring explicit `confidenceNotes`
  detail, since it implicates the governance model itself, not just this initiative.

## Tone notes

Persona: Architecture Review Board, chaired per-initiative (`docs/seed-spec.md` §1; Ray Chen,
Platform Admin, provides infrastructure input but cannot sign per separation of duties, `MP-T-1.3`).
Write like a systems architect: structural, specific about data-flow and failure-mode gaps, neutral
about organizational politics — the ARB evaluates the design, not the requester.
