# Intake Specification — Jeeves (Meridian Health AI Governance Gateway)

Authoritative spec for the structured intake form (plan §2 step 1) and its backing domain object,
`IntakeVersion` (plan §5). All content is fictional (Meridian Health). This document defines what an
engineer needs to implement the form, its validation/completeness rules, and the JSON payload shape —
no chat-based intake is in scope for M1 (plan §11 defers conversational intake).

---

## 1. Form sections and fields

Field `key` values are the canonical keys used in the `IntakeVersion.payload` JSON (§3). Types are
TypeScript-ish; validation is enforced client-side on submit and server-side on write (server is the
source of truth).

### (a) Basics

| Field key | Label | Type | Validation |
|---|---|---|---|
| `title` | Initiative title | `string` | required, 3–120 chars |
| `sponsorOrg` | Sponsor organization | `string` | required, 2–120 chars (e.g. "Clinical Ops") |
| `requesterName` | Requester name | `string` | required, 2–120 chars |
| `requesterEmail` | Requester email | `string` | required, RFC-5322-ish email format |
| `businessProblem` | Business problem | `text` (long string) | required, 20–2000 chars — must describe the problem being solved, not the solution |

### (b) Use case & users

| Field key | Label | Type | Validation |
|---|---|---|---|
| `primaryUsers` | Who uses it | `string` | required, 2–200 chars (role/team, e.g. "Prior-auth nurses") |
| `decisionInformed` | Decision it informs | `string` | required, 2–300 chars — must name the concrete decision (e.g. "coverage approval/denial recommendation") |
| `expectedVolume` | Expected volume | `enum` | required — one of `<100/mo`, `100-1k/mo`, `1k-10k/mo`, `10k-100k/mo`, `>100k/mo` |

### (c) Data

| Field key | Label | Type | Validation |
|---|---|---|---|
| `dataSources` | Data source(s) | `string[]` (multi-entry) | required, ≥1 entry, each 2–200 chars (e.g. "Claims system (Facets)", "Clinical notes (Epic)") |
| `phiCategories` | PHI categories touched | `checklist` (multi-select) | required if `touchesPHI = Y` (see §7 Q1); options: `Demographics`, `Diagnosis/ICD codes`, `Medications`, `Clinical notes/free text`, `Claims/billing`, `Lab results`, `Images`, `Other` (free-text if `Other` checked) |
| `retentionIntent` | Data retention intent | `enum` + `string` note | required if `touchesPHI = Y`; enum one of `Session-only (no persistence)`, `<=30 days`, `<=1 year`, `>1 year`, `Indefinite/per-record-schedule`; optional free-text note (0–300 chars) |
| `trainingVsInference` | Training vs. inference use | `enum` | required — one of `Inference-only`, `Fine-tuning/training`, `Both` |

### (d) Model & vendor

| Field key | Label | Type | Validation |
|---|---|---|---|
| `buildOrBuy` | Build or buy | `enum` | required — one of `Build (internal)`, `Buy (vendor)`, `Hybrid` |
| `vendorName` | Vendor name | `string` | required if `buildOrBuy ∈ {Buy, Hybrid}` OR `vendorHosted = Y` (see §7 Q4); 2–120 chars |
| `hosting` | Hosting | `enum` | required — one of `Vendor-hosted`, `Self-hosted (Meridian infra)`; must be consistent with overlay Q4 (`vendorHosted`) |
| `modelType` | Model type | `enum` | required — one of `LLM (generative)`, `Classical ML / classifier`, `OCR/extraction`, `Rules engine`, `Other` |

### (e) Population & impact

| Field key | Label | Type | Validation |
|---|---|---|---|
| `affectedPopulations` | Affected populations | `string[]` (multi-entry) | required, ≥1 entry (e.g. "Members", "Providers", "Employees") |
| `expectedBenefits` | Expected benefits | `text` | required, 10–1000 chars |
| `expectedHarms` | Expected harms / risks | `text` | required, 10–1000 chars — must not be a copy of `expectedBenefits` (basic non-equality check) |

### (f) Deployment

| Field key | Label | Type | Validation |
|---|---|---|---|
| `integrationPoints` | Integration points | `string[]` (multi-entry) | required, ≥1 entry (e.g. system/workflow the output feeds into) |
| `rolloutPlan` | Rollout plan | `text` | required, 10–1000 chars (pilot scope, phased plan, or full rollout) |

### (g) Overlay questions (verbatim from seed-spec §2.1)

These 6 boolean questions are the authoritative triage inputs (`lib/triage/rules.ts` consumes them
in this order). Wording is copied **verbatim** from seed-spec §2.1; each carries a one-line helper
explaining why it's asked. All 6 are `boolean` (Yes/No), required, no default.

| # | Field key | Question (verbatim) | Type | Helper text (why we ask) |
|---|---|---|---|---|
| 1 | `overlay.touchesPHI` | Does it access PHI? | `boolean` | Determines Privacy/HIPAA control applicability (H-01, H-02) and drives the PHI-category/retention questions above. |
| 2 | `overlay.memberFacing` | Do members interact with or receive its output directly? | `boolean` | Member-facing systems carry higher individual-impact and consumer-protection exposure, and add Legal review (L-02). |
| 3 | `overlay.careCoverageInfluence` | Does it influence care or coverage decisions? | `boolean` | The single strongest driver of tier — care/coverage influence without a human check is Critical (tier rule 1). |
| 4 | `overlay.vendorHosted` | Is the model vendor-hosted? | `boolean` | Vendor hosting triggers Procurement and Legal control requirements (contract addendum, VRA, data-residency attestation). |
| 5 | `overlay.humanInTheLoop` | Does a qualified human review each output before it takes effect? | `boolean` | A human-in-the-loop check downgrades otherwise-Critical care/coverage cases to High (tier rule 2) — it is a mitigating control, not a formality. |
| 6 | `overlay.individualImpact` | Does it affect individuals' opportunities, rights, or services (members, providers, or employees)? | `boolean` | Individual-impact combined with member-facing is an independent High-tier trigger, and feeds Medium-tier default even absent other flags. |

### (h) Evidence attachments (pre-attachable at intake)

Not all seed-spec §3 control evidence exists at intake time — most controls are satisfied later, during
review. The table below maps which evidence types **can** be usefully pre-attached at intake (because the
requester plausibly already has them) versus which are necessarily produced downstream by reviewers/admins.

| Control ID | Evidence type (seed-spec §3) | Pre-attachable at intake? | Notes |
|---|---|---|---|
| L-01 | Signed vendor addendum | Sometimes | Attach if vendor contract already executed; else deferred to Legal review |
| L-02 | Approved copy log | No | Produced during ongoing marketing review cadence, not at intake |
| P-01 | VRA doc | Sometimes | Attach if vendor risk assessment was already run outside Jeeves (e.g. prior procurement cycle) |
| P-02 | Attestation | Sometimes | Attach if vendor already provided a data-residency attestation |
| T-01 | ARB minutes | No | Architecture review happens after intake, during Tech Architecture review |
| T-02 | DR test log | No | Operational artifact, post-deployment |
| R-01 | Bias/fairness test report | Sometimes | Attach if a prior bias test exists (e.g. vendor-supplied); otherwise produced during RAI review |
| R-02 | Model card | Sometimes | Attach vendor- or team-authored model card if one already exists |
| S-01 | Pen test / threat model report | Sometimes | Attach if a pre-existing threat model covers this system |
| S-02 | Access matrix | No | Operational, maintained post-deployment |
| H-01 | DPIA + BAA | Sometimes | BAA may already be executed with the vendor; attach if available. DPIA is usually produced during Privacy review |
| H-02 | De-identification validation report | No | Produced during Privacy/HIPAA review, requires the actual data flow to validate |
| C-01 | Signed clinician-in-the-loop protocol | No | Authored during Clinical Safety review |
| C-02 | Incident log | No | Operational, does not exist pre-deployment |
| D-01 | Data lineage doc | Sometimes | Attach if a lineage doc already exists from a prior data-governance exercise |
| D-02 | Retention & disposal schedule | No | Formalized during Data Governance review, though `retentionIntent` (§1c) captures the requester's stated intent as an input |

Intake evidence upload field: `evidenceAttachments` — `array of { controlId: string, fileName: string, uploadedAt: ISO8601 }`, optional, 0–20 entries. Attaching evidence at intake does not satisfy a control by itself; it is carried forward as a candidate artifact for the assigned reviewer to accept or reject during `ReviewCycle`.

---

## 2. Completeness model

Three levels, evaluated in this order. Implement as a rules table in `lib/intake/completeness.ts` —
each rule is a pure function of the current `IntakeVersion.payload` (+ computed tier where noted) that
returns a pass/fail plus a message.

### Level 1 — BLOCKING (cannot submit; enforced client- and server-side)

The submit action is disabled/rejected until all BLOCKING rules pass. These do not depend on triage
(triage runs only after a valid submission).

| Rule ID | Field(s) checked | Condition to pass |
|---|---|---|
| `BLK-01` | `title` | non-empty, 3–120 chars |
| `BLK-02` | `sponsorOrg` | non-empty, 2–120 chars |
| `BLK-03` | `requesterName`, `requesterEmail` | both non-empty; email matches format |
| `BLK-04` | `businessProblem` | non-empty, ≥20 chars |
| `BLK-05` | `overlay.touchesPHI` | is `true` or `false` (not null/undefined) |
| `BLK-06` | `overlay.memberFacing` | is `true` or `false` |
| `BLK-07` | `overlay.careCoverageInfluence` | is `true` or `false` |
| `BLK-08` | `overlay.vendorHosted` | is `true` or `false` |
| `BLK-09` | `overlay.humanInTheLoop` | is `true` or `false` |
| `BLK-10` | `overlay.individualImpact` | is `true` or `false` |
| `BLK-11` | `dataSources` | array length ≥ 1, each entry 2–200 chars |

### Level 2 — REQUIRED-FOR-TIER (computed after triage runs; blocks tier-appropriate downstream review assignment, not the initial submit)

These fire once `lib/triage/rules.ts` has computed a tier and the flag values are known. A failing
REQUIRED-FOR-TIER rule keeps the initiative in `intake-draft` state (or flags it "incomplete" once
submitted) and prevents `ReviewCycle` creation for the domains that need the missing field, but does
**not** block the initial form submission itself (per plan §2 step 1, the champion case is submitted
with a known gap and the completeness check flags it after the fact).

| Rule ID | Trigger condition | Field(s) required | Condition to pass |
|---|---|---|---|
| `RFT-01` | `overlay.touchesPHI = true` | `phiCategories` | array length ≥ 1 |
| `RFT-02` | `overlay.touchesPHI = true` | `retentionIntent` | enum value set (not null) |
| `RFT-03` | `overlay.vendorHosted = true` OR `buildOrBuy ∈ {Buy, Hybrid}` | `vendorName` | non-empty, 2–120 chars |
| `RFT-04` | `overlay.vendorHosted = true` | `hosting` | must equal `Vendor-hosted` (consistency check) |
| `RFT-05` | `overlay.vendorHosted = false` | `hosting` | must equal `Self-hosted (Meridian infra)` (consistency check) |
| `RFT-06` | `overlay.careCoverageInfluence = true` | `decisionInformed` | non-empty, ≥10 chars (care/coverage cases must clearly name the decision) |
| `RFT-07` | tier ∈ {High, Critical} | `expectedHarms` | non-empty, ≥10 chars, distinct from `expectedBenefits` |
| `RFT-08` | `trainingVsInference ∈ {Fine-tuning/training, Both}` | `dataSources` | at least one entry must not be marked ephemeral/session-only (cross-check against `retentionIntent ≠ Session-only` when PHI=Y) |

### Level 3 — ADVISORY (warnings only; feed the "first-pass completeness" outcome metric, plan §2 outcome strip)

Advisory rules never block anything. Each failing advisory rule counts as one deduction against the
initiative's first-pass completeness score (used in the aggregate "first-pass completeness rate" metric,
seed-spec §6, baseline ~60%).

| Rule ID | Field(s) checked | Condition to pass | Advisory message if failing |
|---|---|---|---|
| `ADV-01` | `expectedVolume` | is set | "Expected volume not estimated — helps size review urgency." |
| `ADV-02` | `affectedPopulations` | array length ≥ 1 | "No affected population named — add at least one (members/providers/employees)." |
| `ADV-03` | `integrationPoints` | array length ≥ 1 | "No integration point named — reviewers need to know where output lands." |
| `ADV-04` | `rolloutPlan` | ≥10 chars | "Rollout plan not described — add pilot scope or phased plan." |
| `ADV-05` | `evidenceAttachments` | array length ≥ 1 when any REQUIRED-FOR-TIER evidence-eligible control applies (§1h "Sometimes" rows) | "No evidence pre-attached — attaching existing artifacts (vendor addendum, model card, etc.) speeds up review." |
| `ADV-06` | `modelType` | is set | "Model type not specified — helps route to the right technical reviewer." |

---

## 3. `IntakeVersion` JSON payload shape

`IntakeVersion` is immutable and versioned per plan §5: resubmission (edit after initial submit, or
edit after a `ReviewDecision` is returned) **creates a new `IntakeVersion` row**, never mutates an
existing one. `Initiative` holds a pointer to the current version; prior versions remain queryable for
audit (seed-spec §5 — every state must be reachable through `AuditEvent`s, including intake submission).

```jsonc
{
  "id": "iv_01J...",                  // ULID/UUID, server-generated, immutable
  "initiativeId": "init_01J...",      // FK to Initiative
  "version": 1,                        // integer, starts at 1, monotonically increasing per initiativeId
  "status": "draft" | "submitted",     // draft = editable in place (pre-first-submit only); submitted = frozen
  "submittedAt": "2026-07-10T00:00:00Z" | null,
  "submittedBy": "user_01J..." | null,  // FK to actor
  "supersedesVersionId": "iv_01J..." | null,  // prior IntakeVersion.id this one replaces, or null for v1

  "payload": {
    "basics": {
      "title": "string",
      "sponsorOrg": "string",
      "requesterName": "string",
      "requesterEmail": "string",
      "businessProblem": "string"
    },
    "useCase": {
      "primaryUsers": "string",
      "decisionInformed": "string",
      "expectedVolume": "<100/mo" | "100-1k/mo" | "1k-10k/mo" | "10k-100k/mo" | ">100k/mo" | null
    },
    "data": {
      "dataSources": ["string", "..."],
      "phiCategories": ["Demographics" | "Diagnosis/ICD codes" | "Medications" | "Clinical notes/free text" | "Claims/billing" | "Lab results" | "Images" | "Other", "..."],
      "phiCategoriesOtherText": "string" | null,
      "retentionIntent": "Session-only (no persistence)" | "<=30 days" | "<=1 year" | ">1 year" | "Indefinite/per-record-schedule" | null,
      "retentionIntentNote": "string" | null,
      "trainingVsInference": "Inference-only" | "Fine-tuning/training" | "Both" | null
    },
    "modelVendor": {
      "buildOrBuy": "Build (internal)" | "Buy (vendor)" | "Hybrid" | null,
      "vendorName": "string" | null,
      "hosting": "Vendor-hosted" | "Self-hosted (Meridian infra)" | null,
      "modelType": "LLM (generative)" | "Classical ML / classifier" | "OCR/extraction" | "Rules engine" | "Other" | null
    },
    "populationImpact": {
      "affectedPopulations": ["string", "..."],
      "expectedBenefits": "string" | null,
      "expectedHarms": "string" | null
    },
    "deployment": {
      "integrationPoints": ["string", "..."],
      "rolloutPlan": "string" | null
    },
    "overlay": {
      "touchesPHI": true | false | null,
      "memberFacing": true | false | null,
      "careCoverageInfluence": true | false | null,
      "vendorHosted": true | false | null,
      "humanInTheLoop": true | false | null,
      "individualImpact": true | false | null
    },
    "evidenceAttachments": [
      { "controlId": "string", "fileName": "string", "uploadedAt": "ISO8601" }
    ]
  },

  "completeness": {
    "blocking": { "passed": true, "failedRuleIds": [] },
    "requiredForTier": { "tier": "Critical" | "High" | "Medium" | "Low" | null, "failedRuleIds": ["string", "..."] },
    "advisory": { "failedRuleIds": ["string", "..."], "score": 0.0 }
  }
}
```

Notes:
- `completeness` is a computed/cached projection, recomputed on every read of the current version and
  persisted at submit time for audit fidelity (so an auditor sees the completeness state *as evaluated
  at submission*, not recomputed against later rule changes).
- `version` and `supersedesVersionId` together form an immutable chain per `initiativeId` — this is what
  plan §5's "versioned, registry as a view" means for intake: the registry/UI always joins to the latest
  `submitted` version, but every prior version stays in the table, linked by `AuditEvent`s ("intake
  submitted" at each version).

---

## 4. Champion prefill — "Prior-Auth Clinical Summarizer" (seed-spec initiative #1)

Overlay flags per seed-spec §2 table: **PHI=Y / member-facing=Y / care-coverage=Y / vendor-hosted=Y /
human-in-the-loop=N / individual-impact=Y**. Per plan §2 step 1, this prefill deliberately **omits
`retentionIntent`** so the completeness check visibly flags it live during the demo.

```json
{
  "payload": {
    "basics": {
      "title": "Prior-Auth Clinical Summarizer",
      "sponsorOrg": "Clinical Ops",
      "requesterName": "Priya Raman",
      "requesterEmail": "priya.raman@meridianhealth-demo.example",
      "businessProblem": "Prior-authorization nurses spend 15-20 minutes per case manually reading clinical notes, prior visit summaries, and lab results scattered across Epic to assemble a coverage-decision packet. Case volume has grown 22% year over year and review backlog now averages 4.5 days, delaying care decisions for members."
    },
    "useCase": {
      "primaryUsers": "Prior-authorization nurses (Clinical Ops)",
      "decisionInformed": "Coverage approval/denial recommendation presented to the prior-auth nurse before she issues the determination",
      "expectedVolume": "10k-100k/mo"
    },
    "data": {
      "dataSources": ["Clinical notes (Epic)", "Prior visit summaries (Epic)", "Lab results (Epic)", "Claims history (Facets)"],
      "phiCategories": ["Diagnosis/ICD codes", "Medications", "Clinical notes/free text", "Lab results"],
      "phiCategoriesOtherText": null,
      "retentionIntent": null,
      "retentionIntentNote": null,
      "trainingVsInference": "Inference-only"
    },
    "modelVendor": {
      "buildOrBuy": "Buy (vendor)",
      "vendorName": "Halcyon Clinical AI, Inc.",
      "hosting": "Vendor-hosted",
      "modelType": "LLM (generative)"
    },
    "populationImpact": {
      "affectedPopulations": ["Members", "Prior-auth nurses (Clinical Ops)"],
      "expectedBenefits": "Reduces nurse review time per case from ~18 minutes to an estimated ~6 minutes by pre-summarizing clinical evidence against the applicable coverage policy, shrinking the prior-auth backlog and speeding time-to-decision for members awaiting care.",
      "expectedHarms": "Summarization errors or omissions could cause a nurse to miss clinically relevant evidence, leading to an incorrect coverage determination; over-reliance on the summary could erode the nurse's independent clinical judgment over time."
    },
    "deployment": {
      "integrationPoints": ["Prior-auth workflow queue (internal case management system)", "Nurse review workbench UI"],
      "rolloutPlan": "Pilot with one prior-auth team (8 nurses) for 4 weeks with 100% human review of summarizer output before any workflow change, then phased rollout to remaining Clinical Ops teams pending pilot results and Clinical Safety sign-off."
    },
    "overlay": {
      "touchesPHI": true,
      "memberFacing": true,
      "careCoverageInfluence": true,
      "vendorHosted": true,
      "humanInTheLoop": false,
      "individualImpact": true
    },
    "evidenceAttachments": []
  }
}
```

Field deliberately left blank for the live demo: **`data.retentionIntent`** (and its paired
`retentionIntentNote`). Everything else above is fully populated and passes BLOCKING and all other
REQUIRED-FOR-TIER rules.

---

## 5. Worked completeness evaluation for the champion prefill

**Step 1 — BLOCKING.** All 11 BLOCKING rules (`BLK-01`…`BLK-11`) pass: basics are complete, all 6 overlay
answers are set (including `humanInTheLoop = false`, which is a valid answer, not a missing one), and
`dataSources` has 4 entries. **Result: submission is allowed.**

**Step 2 — Triage runs** (`lib/triage/rules.ts`, seed-spec §2.1, first match wins):
- Flags: PHI=Y, member-facing=Y, care-coverage=Y, vendor-hosted=Y, human-in-loop=N, individual-impact=Y.
- Rule 1: `care-coverage ∧ ¬human-in-loop` → **matches** → **Tier = Critical**.
- Required domains: Critical → all 8 domains (Legal, Procurement, Tech Architecture, Responsible AI, Security, Privacy/HIPAA, Clinical Safety, Data Governance).

**Step 3 — REQUIRED-FOR-TIER evaluation** (now that tier and flags are known):

| Rule ID | Trigger present? | Field checked | Result |
|---|---|---|---|
| `RFT-01` | Yes (`touchesPHI=true`) | `phiCategories` | **Pass** — 4 entries present |
| `RFT-02` | Yes (`touchesPHI=true`) | `retentionIntent` | **FAIL** — value is `null` |
| `RFT-03` | Yes (`vendorHosted=true`) | `vendorName` | **Pass** — "Halcyon Clinical AI, Inc." |
| `RFT-04` | Yes (`vendorHosted=true`) | `hosting` | **Pass** — equals `Vendor-hosted` |
| `RFT-05` | No (`vendorHosted=true`, so this rule doesn't trigger) | — | n/a |
| `RFT-06` | Yes (`careCoverageInfluence=true`) | `decisionInformed` | **Pass** — populated, 13+ chars |
| `RFT-07` | Yes (tier=Critical, which is in {High, Critical}) | `expectedHarms` | **Pass** — populated and distinct from `expectedBenefits` |
| `RFT-08` | No (`trainingVsInference = Inference-only`) | — | n/a |

**One rule fails: `RFT-02`.**

**Step 4 — ADVISORY evaluation:**

| Rule ID | Result |
|---|---|
| `ADV-01` | Pass — `expectedVolume` set |
| `ADV-02` | Pass — 2 affected populations |
| `ADV-03` | Pass — 2 integration points |
| `ADV-04` | Pass — rollout plan populated |
| `ADV-05` | **FAIL** — `evidenceAttachments` empty, and this initiative has evidence-eligible controls (vendor-hosted ⇒ L-01/P-01/P-02 are "Sometimes" pre-attachable per §1h) |
| `ADV-06` | Pass — `modelType` set |

**What the completeness meter shows in the demo:**

- Submission is **not blocked** (all BLOCKING rules green) — the requester can submit.
- Immediately after triage computes **Tier = Critical**, the completeness panel shows:
  - **1 REQUIRED-FOR-TIER gap**: "PHI data retention intent is required for PHI-touching initiatives — please specify how long this data will be retained." (rule `RFT-02`), displayed as a red/amber flag on the initiative's intake tab, blocking `ReviewCycle` creation for the domains that need it (Privacy/HIPAA's D-02/H-01 evidence expectations depend on stated retention intent) until resolved.
  - **1 ADVISORY note**: "No evidence pre-attached — attaching existing artifacts (vendor addendum, model card, etc.) speeds up review." (rule `ADV-05`), non-blocking.
- First-pass completeness score for this submission: 6 of 8 evaluated non-blocking checks pass
  (2 REQUIRED-FOR-TIER applicable rules pass out of 3 applicable, plus 5 of 6 advisory rules pass) —
  this submission counts as a **first-pass-incomplete** case in the aggregate "first-pass completeness
  rate" outcome metric (seed-spec §6 baseline ~60%), which is the intended demo beat: the champion case
  visibly is not perfect on first pass, and the reviewer/requester loop to fill in retention intent is
  part of the governance story, not a bug.

---

## 6. Conflicts / ambiguities noticed between plan.md and seed-spec.md

1. **Which field is "the" missing one is not stated in either doc as a field key** — plan §2 step 1 says
   only "completeness check flags a missing data-retention answer." Seed-spec has no intake-field-level
   spec at all (it only asserts initiative #1 is "not seeded past intake-draft — created live during the
   demo"). This spec resolves the gap by naming the field `data.retentionIntent` and tying it to
   REQUIRED-FOR-TIER rule `RFT-02`, gated on `touchesPHI=true`. This is an inference, not a verbatim
   requirement from either source — flagging it in case the demo script (not yet read) expects a
   different field to be the "gotcha."
2. **Tier terminology overlap with "required-for-tier" naming**: seed-spec §2.1 uses "tier" exclusively
   for the 4-value risk tier (Low/Med/High/Critical) driving *review domain* requirements. This spec
   reuses "tier" in the completeness level name `REQUIRED-FOR-TIER` per the task instructions, but it's
   worth flagging that intake-completeness triggers (PHI=Y needs retention; vendor=Y needs vendor name)
   are driven by the raw **overlay flags**, not by the derived tier value itself — e.g. `RFT-07`
   (expectedHarms required) is the only rule in this spec keyed off the derived tier rather than a raw
   flag. No contradiction, just a naming overlap worth an engineer's awareness.
3. **Seed-spec §2 marks initiative #1 as "not seeded past intake-draft"** while plan §2 step 1 describes
   the intake as happening live in the demo — consistent, no conflict, but it means the champion
   `IntakeVersion` prefill in §4 above must be seeded/loadable as a **draft** (version 1, `status: "draft"`
   or pre-submit), not as an already-`submitted` row, so the live demo can actually perform the submit
   action on stage. Implementers should make sure `scripts/seed.ts` does not pre-submit initiative #1's
   intake.
4. **No explicit validation ranges given in either source doc** (string min/max lengths, enum option
   lists for fields like `expectedVolume`, `modelType`) — plan.md and seed-spec.md operate one level
   above the intake-form field spec (they define the 6 overlay questions and the tier/control model, not
   free-text field constraints). All non-overlay field types, enums, and length bounds in §1 and §3 of
   this document are original to this spec (reasonable defaults for a demo), not sourced from either
   input document, and should be treated as proposed rather than locked.
