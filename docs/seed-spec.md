# Seed Data Specification — Meridian Health AI Portfolio

Deterministic synthetic dataset for the Jeeves demo. Authoritative input to `scripts/seed.ts` (M1-P1).
All data fictional. Generation rules: fixed PRNG seed `"meridian-2026"`, fixed base date `2026-07-01T00:00:00Z`
(no wall-clock reads in generators — plan §8 test 5 requires byte-identical re-seeds).

## 1. Actors (fictional)

| Name | Role(s) | Notes |
|---|---|---|
| Priya Raman | Requester (Clinical Ops) | Champion initiative requester |
| Dan Kowalski | Requester (Marketing) | Fast-lane requester |
| Dr. Elena Vasquez | Reviewer — Clinical Safety | Signs champion clinical review |
| Marcus Webb | Reviewer — Privacy/HIPAA | |
| Sofia Grant | Reviewer — Responsible AI | Authors the returned review on #9 |
| James Liu | Reviewer — Legal | |
| Angela Torres | **Accountable approver** (VP, AI Governance) | Named on all approvals incl. fast-lane policy |
| Ray Chen | Admin (Platform) | The two live admin actions; CANNOT approve/sign (separation of duties) |
| Nia Okafor | Program office | Owns SLA/pipeline views |

## 2. Initiatives (12)

| # | slug | Title | Overlay flags (PHI / member-facing / care-coverage / vendor) | Tier | State at seed time | Storyline purpose |
|---|---|---|---|---|---|---|
| 1 | `prior-auth-summarizer` | Prior-Auth Clinical Summarizer | Y/Y/Y/Y | Critical | **Not seeded past intake-draft** — created live during the demo | Champion vertical (plan §2) |
| 2 | `marketing-ab-tester` | Marketing Copy A/B Tester | N/N/N/Y | Low | Approved via **fast-lane policy FL-2026-01**, approver Angela Torres, deployed | Fast-lane counterpoint; accountable approver visible |
| 3 | `social-sentiment-miner` | Member Social-Media Sentiment Miner | Y/Y/N/Y | High | **Rejected** (Privacy/HIPAA + RAI decisions cite consent + surveillance policies) | Governance that says no |
| 4 | `member-chat-copilot` | Member Services Chat Copilot | Y/Y/N/N | High | Deployed v1.2; **eval hallucination-rate series trending up, crosses threshold 0.08 at base+9d** | The live breach → pause → reassessment demo |
| 5 | `pa-correspondence-model` | Prior-Auth Correspondence Drafting Model | Y/N/Y/N | Critical | Deployed v2.0; **v2.1 checkpoint awaiting feedback-provenance sign-off** (promotion gate) | RL/version-promotion story |
| 6 | `claims-ocr-coder` | Claims Document OCR + Coding Model | Y/N/Y/N | High | Deployed, **self-hosted** — the only initiative with GPU utilization series | GPU panel + quota controls (M3) |
| 7 | `provider-dedup-agent` | Provider Directory Dedup Agent | N/N/N/N | Medium | In review: 3 of 5 required domains signed | Mid-pipeline state |
| 8 | `nurse-triage-summarizer` | Nurse Triage Line Summarizer | Y/N/Y/N | Critical | **Conditionally approved** — 2 open conditions linked to controls (human-review sampling; escalation protocol) | Conditional-approval mechanics |
| 9 | `formulary-qa-bot` | Member Formulary Q&A Bot | Y/Y/N/Y | High | In review: RAI review **returned** by Sofia Grant (missing bias-testing evidence) | Returned/iteration state |
| 10 | `fwa-anomaly-detector` | Fraud, Waste & Abuse Anomaly Detector | Y/N/Y/N | High | Operating 14 months; **periodic review overdue at base date** | Evidence-freshness / overdue-controls metric |
| 11 | `hr-resume-screener` | HR Résumé Screener | N/N/N/Y | Medium | Approved with an **exception request pending** (bias-audit cadence waiver) | Exception workflow (M4) |
| 12 | `callcenter-qa-scorer` | Call Center QA Auto-Scorer | N/N/N/N | Medium | Operating, healthy, all controls green | The boring healthy one — baseline |

Tier derivation must come from `lib/triage/rules.ts` applied to the overlay flags — the seed asserts the
expected tier and FAILS if rules disagree (keeps seed and rules from drifting).

## 3. Control catalog (ControlDefinition — 2 per domain, 16 total)

Format: id · name · applicability · enforcement mode · cadence · required evidence. Policy source: fictional
"Meridian AI Policy" sections MP-§n vN. Owners drawn from §1 actors. Full field set per plan §6.

- **Legal**: L-01 Vendor contract AI addendum (vendor=Y; gate; once; signed addendum) · L-02 Marketing-claims review (member-facing=Y; monitor; quarterly; approved copy log)
- **Procurement**: P-01 Vendor risk assessment (vendor=Y; gate; annual; VRA doc) · P-02 SaaS data-residency attestation (vendor=Y; monitor; annual; attestation)
- **Tech Architecture**: T-01 Architecture review record (all ≥Medium; gate; once + on material change; ARB minutes) · T-02 Disaster-recovery plan (tier ≥High; monitor; annual; DR test log)
- **Responsible AI**: R-01 Bias & fairness testing (member-facing or care-coverage; gate; semi-annual; test report) · R-02 Model card published (all ≥Medium; monitor; on version change; model card)
- **Security**: S-01 Pen test / threat model (tier ≥High; gate; annual; report) · S-02 Secrets & access review (all; monitor; quarterly; access matrix)
- **Privacy/HIPAA**: H-01 PHI minimization & BAA (PHI=Y; gate; once + on data change; DPIA + BAA) · H-02 De-identification validation (PHI=Y ∧ vendor=Y; gate; annual; validation report)
- **Clinical Safety**: C-01 Clinician-in-the-loop protocol (care-coverage=Y; gate; once; signed protocol) · C-02 Adverse-event monitoring (care-coverage=Y; monitor; continuous; incident log)
- **Data Governance**: D-01 Data lineage & sourcing approval (all ≥Medium; gate; once + on data change; lineage doc) · D-02 Retention & disposal schedule (PHI=Y; monitor; annual; schedule)

Plus the **live-enforced eval-quality control**: `Q-01 Eval quality floor` — observation kind
`eval_hallucination`, threshold 0.08 (tier default for High; Critical default 0.05), sustained-window 3
consecutive points, enforcement `block` (pause deployment). This is the one control with runtime teeth in M1;
all others render as catalog + evidence status.

## 4. Telemetry series (Observation) — per deployed initiative

Kinds: `cost_tokens_usd_day`, `eval_hallucination`, `eval_relevance`, `gpu_util_pct` (#6 only).
30 daily points ending base+14d, generated as `f(day) + seededNoise(slug, kind)`:

- #4 `member-chat-copilot` · eval_hallucination: 0.045 + 0.0035·day → crosses 0.08 at day ~9, stays above (sustained ≥3 → breach fires when monitor runs)
- #4 cost: ramp $80→$140/day (supports the cost panel + budget bar)
- #5, #12: flat healthy eval series (0.03–0.05 band); #5 shows v2.0→v2.1 offline eval comparison instead of live drift
- #6 gpu_util_pct: weekday sinusoid 55–85%, weekend 20–30%, quota line at 80%
- #10: no eval series (pre-LLM ML model) — cost only; its "red" state comes from overdue review, not telemetry
- Every panel labeled "Synthetic data — demo", connector chip "Arize: not connected" (until M3)

## 5. Pre-seeded audit trail

Every seeded state above must be reachable through AuditEvents (no orphan states): intake submitted →
triage classified (with rule inputs) → reviews drafted/signed/returned → decisions (with approver + conditions)
→ deployments → control attestations → admin threshold change (one historical: Ray Chen tightened Q-01
from 0.10→0.08 on base−30d, reason "Q2 quality initiative" — foreshadows the breach). Rejected #3 and
returned #9 include the full decision text. Target ≈120–150 events total.

## 6. Outcome metrics (computed, not seeded — but seed must make them non-trivial)

Review cycle time (median ~11d, champion will beat it live) · first-pass completeness (~60%) ·
reviewer hours saved (drafted-vs-scratch estimate, ~4h/review) · evidence freshness (10/12 fresh;
#10 and #11 stale) · overdue controls (3: #10 periodic review, #11 bias audit, #9 missing evidence).

## 7. Structured audit queries that must work day one (plan §8 test 10)

1. "Member-facing initiatives touching PHI" → #1(live), #3(rejected), #4, #9 with approver + control status
2. "Everything approved by Angela Torres" → decisions with links
3. "Overdue controls" → the 3 in §6 with remediation owners
4. "What changed on Q-01 and who changed it" → the base−30d admin event
