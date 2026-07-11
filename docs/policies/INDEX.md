# Meridian AI Policy Corpus — Index

Fictional policy corpus for the Jeeves demo (Meridian Health). This index maps each policy file
to its policy id, its stable section anchors, and the seed-spec (`docs/seed-spec.md` §3) control
ids that cite it. All citations below were verified against the current corpus content.

| File | Policy ID | Section anchors (top-level) | Seed-spec §3 control(s) citing it |
|---|---|---|---|
| `legal.md` | Meridian AI Policy — Legal Domain, MP-L v3 | MP-L-1 … MP-L-8 | L-01 (MP-L-2), L-02 (MP-L-3) |
| `procurement.md` | Meridian AI Policy — Procurement Domain, MP-P v2 | MP-P-1 … MP-P-8 | P-01 (MP-P-2), P-02 (MP-P-3) |
| `tech-architecture.md` | Meridian AI Policy — Technology Architecture Domain, MP-T v2 | MP-T-1 … MP-T-7 | T-01 (MP-T-2), T-02 (MP-T-3) |
| `responsible-ai.md` | Meridian AI Policy — Responsible AI Domain, MP-R v4 | MP-R-1 … MP-R-7 | R-01 (MP-R-2), R-02 (MP-R-3) |
| `security.md` | Meridian AI Policy — Security Domain, MP-S v3 | MP-S-1 … MP-S-7 | S-01 (MP-S-2), S-02 (MP-S-3) |
| `privacy-hipaa.md` | Meridian AI Policy — Privacy/HIPAA Domain, MP-H v3 | MP-H-1 … MP-H-7 | H-01 (MP-H-2), H-02 (MP-H-3) |
| `clinical-safety.md` | Meridian AI Policy — Clinical Safety Domain, MP-C v3 | MP-C-1 … MP-C-7 | C-01 (MP-C-2), C-02 (MP-C-3) |
| `data-governance.md` | Meridian AI Policy — Data Governance Domain, MP-D v2 | MP-D-1 … MP-D-7 | D-01 (MP-D-2), D-02 (MP-D-3) |
| `fast-lane-policy.md` | Pre-Approved Fast-Lane Policy, FL-2026-01 v1 | FL-1 … FL-6 | Not a seed-spec §3 control; cited directly by initiative #2 (`marketing-ab-tester`) per seed-spec §2 row 2 and by plan.md §2 step 7 |

## Section-anchor scheme

Every domain file uses the stable anchor pattern `MP-<domain-letter>-<section>[.<subsection>]`,
e.g. `MP-H-3.2`. Domain letters: L=Legal, P=Procurement, T=Tech Architecture, R=Responsible AI,
S=Security, H=Privacy/HIPAA, C=Clinical Safety, D=Data Governance. The fast-lane policy uses its
own prefix `FL-<section>[.<subsection>]` since it is a cross-cutting policy rather than a
governance-domain policy. Anchors are numbered top-level sections (purpose/scope, each named
control, champion-class criteria, grounds for rejection, re-review triggers, returned-review
handling) with decimal subsections holding individually quotable normative statements. Anchors
are stable across policy version bumps (`vN` in the header) — a version bump may add subsections
but must not renumber existing ones, so historical citations in audit/decision records remain
valid.

## Control-to-section cross-reference (seed-spec §3 detail)

| Control ID | Control name | Primary section(s) |
|---|---|---|
| L-01 | Vendor contract AI addendum | MP-L-2 (MP-L-2.1–MP-L-2.4) |
| L-02 | Marketing-claims review | MP-L-3 (MP-L-3.1–MP-L-3.4) |
| P-01 | Vendor risk assessment | MP-P-2 (MP-P-2.1–MP-P-2.4) |
| P-02 | SaaS data-residency attestation | MP-P-3 (MP-P-3.1–MP-P-3.3) |
| T-01 | Architecture review record | MP-T-2 (MP-T-2.1–MP-T-2.4) |
| T-02 | Disaster-recovery plan | MP-T-3 (MP-T-3.1–MP-T-3.3) |
| R-01 | Bias & fairness testing | MP-R-2 (MP-R-2.1–MP-R-2.4) |
| R-02 | Model card published | MP-R-3 (MP-R-3.1–MP-R-3.3) |
| S-01 | Pen test / threat model | MP-S-2 (MP-S-2.1–MP-S-2.4) |
| S-02 | Secrets & access review | MP-S-3 (MP-S-3.1–MP-S-3.4) |
| H-01 | PHI minimization & BAA | MP-H-2 (MP-H-2.1–MP-H-2.5) |
| H-02 | De-identification validation | MP-H-3 (MP-H-3.1–MP-H-3.3) |
| C-01 | Clinician-in-the-loop protocol | MP-C-2 (MP-C-2.1–MP-C-2.4) |
| C-02 | Adverse-event monitoring | MP-C-3 (MP-C-3.1–MP-C-3.3) |
| D-01 | Data lineage & sourcing approval | MP-D-2 (MP-D-2.1–MP-D-2.4) |
| D-02 | Retention & disposal schedule | MP-D-3 (MP-D-3.1–MP-D-3.4) |

`Q-01 Eval quality floor` (the live-enforced eval-quality control) is intentionally **not** a
policy-corpus citation — per seed-spec §3 it is a runtime/telemetry control (threshold, sustained
window, enforcement `block`) defined in the control catalog schema itself, not sourced to an
`MP-§n` policy section. No policy file cites it and none should.

## Storyline cross-references (for review-drafting agents)

- **Champion (#1 `prior-auth-summarizer`):** each domain's "Champion-Class Review Criteria"
  section is the direct citation target — MP-L-4, MP-P-4, MP-T-4, MP-R-4, MP-S-4, MP-H-4, MP-C-4,
  and MP-D-4 all address the PHI/member-facing/care-coverage/vendor profile explicitly.
- **Rejected #3 (`social-sentiment-miner`):** cite MP-H-5.1(b)/MP-H-5.2, MP-R-5.1(a)/MP-R-5.2, and
  MP-L-6.1(b)/MP-L-6.2 — the three domains' jointly-cross-referenced "unconsented inference from
  monitored member/public communications" ground for rejection. MP-D-5.2 covers the same fact
  pattern from a lineage-approval angle if a data-sourcing citation is needed.
  fast-lane rejections are not applicable here since #3 is High tier, not Low.
- **Returned #9 (`formulary-qa-bot`):** cite MP-R-2.4 / MP-R-7 (Responsible AI returned review for
  missing bias-testing evidence) — this is the section written specifically for that storyline
  beat. MP-H-7.3 explicitly notes Privacy does not piggyback a return on missing bias evidence
  alone, to keep the domains' independence clear if both are referenced in the same scene.
- **Fast-lane (#2 `marketing-ab-tester`):** cite FL-2.1 (eligibility), FL-3.1–FL-3.2 (named
  accountable approver mechanism, Angela Torres), and FL-4 (audit requirements).
- **Conditional approval (#8 `nurse-triage-summarizer`):** cite MP-C-4.2 (conditions linked to
  C-01/C-02: human-review sampling rate, escalation-protocol refinement) and MP-C-5.2 (conditional
  approval preferred over rejection when the core clinician-in-the-loop checkpoint is present).
- **Overdue periodic review (#10 `fwa-anomaly-detector`):** cite MP-D-3.2 / MP-D-7.2 (retention
  schedule annual cadence and staleness flag) or the relevant domain's own re-review section
  depending on which control is overdue in the seeded data.
- **Exception request pending (#11 `hr-resume-screener`):** cite MP-R-2.3 (semi-annual bias-audit
  cadence) as the control an exception would waive; this policy corpus does not define a separate
  exception-process section per file — the exception process itself is expected to live in the
  application's control-catalog schema (`exception process` field, plan.md §6), not restated here
  per policy.

## Verification notes / mismatches

All 16 control ids in seed-spec §3 (L-01, L-02, P-01, P-02, T-01, T-02, R-01, R-02, S-01, S-02,
H-01, H-02, C-01, C-02, D-01, D-02) resolve to a section in this corpus. No mismatches found.

Seed-spec §3 does not itself write out literal `MP-§n vN` strings for each control (it states the
convention once: "Policy source: fictional 'Meridian AI Policy' sections MP-§n vN"); this index
therefore maps by control id → domain → section rather than by parsing literal citation strings
out of seed-spec.md. If a future seed or review-drafting agent needs a literal per-control
citation string (e.g., for a `ControlDefinition.policySource` field), use the "Primary section(s)"
column above, e.g. `H-01` → `"MP-H v3 §MP-H-2"`.

No other mismatches identified.
