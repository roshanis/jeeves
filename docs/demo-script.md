# Jeeves Demo Script — Meridian Health AI Governance Gateway
## Stakeholder Walkthrough (15 minutes)

**Audience:** Executives and AI-governance leaders at large healthcare payer organizations  
**Product:** Jeeves on Meridian Health (fictional payer, synthetic data)  
**Format:** 15-minute timed walkthrough with live demo, anticipated stakeholder questions, and crisp answers.

---

## Cold Open (1 min)
**On screen:** Dashboard header, no data visible yet. Title slide: "The AI Approval Problem."

**Presenter talk track:**
"We manage 12 AI initiatives across Meridian Health — but here's the problem: every request lands in email, tickets, or committee notes. There's no unified inventory. No one knows which models touch member data, which ones influence coverage decisions, or whether their oversight is current. When something breaks, the audit trail is scattered across systems. Jeeves solves this with one insight: approval isn't the end of governance, it's a checkpoint. Real accountability starts after deployment — when we monitor, measure, and escalate breaches in real time."

**Anticipated question:** *"How is this different from our current vendor-review process?"*

**Answer:** "Vendors do once-per-year gate reviews. Jeeves runs continuous monitoring on deployed models — hallucination rates, cost trends, clinical safety incidents — and pauses deployment automatically if a threshold breaks. It links that breach back to the original approval decision, so you know exactly who approved what and whether the controls we promised are actually working. That's the fast-lane we'll show you: governance speed + accountability retained."

---

## Portfolio View (2 min)
**On screen:** Initiative list page showing 12 seeded initiatives (titles, tiers, states, outcome metrics strip at top).

**Presenter talk track:**
"This is Meridian's AI portfolio — 12 live and in-flight initiatives. You see tier colors (green Low, blue Medium, orange High, red Critical), approval states, and five outcome metrics: median review cycle time, first-pass completeness, estimated reviewer hours freed up by agent-drafted reviews, evidence freshness, and overdue controls. Over there, you'll notice three red flags: social-sentiment-miner was rejected because of consent and surveillance policies. Formulary Q&A is returned — it's missing bias-testing evidence. And FWA anomaly detector is overdue for periodic review. That's governance that works: we say no, we escalate gaps, and we track what's late."

**Anticipated question:** *"Are these real initiatives or synthetic?"*

**Answer:** "All synthetic data — this is a demo on fictional Meridian Health. The portfolio shows patterns we see in real payers: a healthy baseline (call-center QA scorer), some mature models that deployed smoothly, some rejected for policy reasons, and some in-flight waiting for sign-off. The important part is the mechanics: you'll watch how a new request flows through intake → triage → multi-domain review → conditional approval → deployment → live monitoring."

---

## Live Champion Run: Prior-Auth Clinical Summarizer (6 min)

### Step 1: Intake Form (0.5 min)
**On screen:** Structured intake form (no chat), partially filled with patient data access, member-facing, care/coverage influence flags.

**Presenter talk track:**
"This is Priya from Clinical Ops submitting a new initiative: 'Prior-Auth Clinical Summarizer.' It's a model that ingests member records and generates summaries for clinicians to use in prior-auth decisions. Priya answers our structured intake questions: Does it access PHI? Yes. Does its output reach members? Yes — the summaries feed the determination letters members receive. Does it influence care or coverage decisions? Yes. Is it vendor-hosted? Yes. Is each output reviewed by a human before it takes effect? No. The form flags a missing data-retention answer — she can submit, but the gap is tracked and must close before approval. Jeeves enforces completeness — no garbage in, no garbage out."

**Anticipated question:** *"Why not a conversational chat instead of a form?"*

**Answer:** "Forms are deterministic. Chat is fluid and comfortable, but it makes triage non-reproducible — an agent might extract different risk flags depending on how the question was phrased. We do plan conversational intake in M2, but for the governance loop to work, the triage classifier must see the same facts every time. Forms enforce that discipline."

---

### Step 2: Deterministic Triage → Critical Tier (0.5 min)
**On screen:** Triage summary (flags shown, rule reasoning, resulting tier: Critical).

**Presenter talk track:**
"Jeeves applies triage rules: the model accesses PHI, influences care decisions, and is vendor-hosted. Our rule engine classifies it as Critical — which means all eight governance domains are required: Legal, Procurement, Tech Architecture, Responsible AI, Security, Privacy/HIPAA, Clinical Safety, and Data Governance. That's non-negotiable for a member-facing, care-influencing model on a vendor platform."

**Anticipated question:** *"What if the triage classifier gets it wrong?"*

**Answer:** "It can't, in this demo. The rules are hardcoded logic, not an ML model — if PHI + care-coverage + no human-in-loop, tier is Critical, period. In production you'd want human override capability, and that's documented in our backlog (M4 hardening). For now, the rules are deterministic: they pass automated tests and enforce consistently."

---

### Step 3: Agent-Drafted Reviews — All Eight Domains Live (1.5 min)
**On screen:** Review panel showing all eight drafts appearing live, fanned out in parallel:
- **Responsible AI** (Sofia Grant's domain): "Model card required; fairness testing protocol attached to control R-01."
- **Privacy/HIPAA** (Marcus Webb): "BAA + PHI minimization checklist; DPIA required before deployment."
- **Clinical Safety** (Dr. Elena Vasquez): "Clinician-in-the-loop protocol; adverse-event monitoring linked to control C-02."
- **Legal** (James Liu): "Vendor contract must include AI addendum; model liability and IP terms to be negotiated."
- **Security**, **Tech Architecture**, **Data Governance**, **Procurement** — drafted the same way: each pulls its relevant controls from the catalog and proposes evidence requirements, rendered identically to the four above as they land.

**Presenter talk track:**
"Here's where Jeeves adds velocity. The system triggers agent-drafted reviews for all eight domains in parallel — a bounded-concurrency fan-out, not a sequential queue. Each draft pulls in relevant controls from our catalog and suggests evidence requirements. The drafts aren't approvals; they're structured starting points for human reviewers. Humans edit, sign, or return them. All eight domains required, all eight drafted live — no templated stand-ins."

**Anticipated question:** *"What if an agent drafts a bad review — say, it misses a legal risk?"*

**Answer:** "The agent doesn't approve. A human reviewer reads the draft, catches the gap, edits it, and signs. If they want to reject the entire initiative, they can return the draft with comments. The agent is a research assistant, not a decision-maker. Angela Torres — our accountable approver — sees the final signed reviews before issuing approval. Accountability stays with humans."

---

### Step 4: Human Review, Sign-Off, Conditional Approval (1.5 min)
**On screen:** One reviewer edits a draft (e.g., Marcus adds a bullet to privacy checklist), signs it. Decision transitions to "Awaiting Approval." Then Angela Torres appears to issue a Conditional Approval linking named conditions to control assignments.

**Presenter talk track:**
"Dr. Vasquez reviews the Clinical Safety draft, adds a note about escalation protocols, and signs off. Marcus adds a DPIA checklist item and signs Privacy. All eight domains are now reviewed — some signed after edits, some signed as drafted. Angela Torres, our accountable approver, reviews the dossier and issues a Conditional Approval: the initiative can deploy to production, but only if it meets three conditions — clinician-in-the-loop protocol live (control C-01), BAA executed (control H-01), and bias-fairness testing on file (control R-01). Those conditions are tied to controls and their evidence status. If the controls are not met, the deployment is blocked. Angela's name is on it — she owns the risk."

**Anticipated question:** *"Who is Angela Torres? What if she's not available?"*

**Answer:** "Angela is VP of AI Governance at Meridian. She's the pre-configured accountable approver for all high-risk initiatives in this demo. In a real system, you'd configure this per policy or per role. Jeeves doesn't do agent-approval; it logs the human accountable for every decision. If Angela is unavailable, the initiative sits in 'Awaiting Approval' until someone with that authority signs off. No workarounds."

---

### Step 5: Versioned Effective Controls Generated (0.5 min)
**On screen:** Control assignment table showing the three linked controls (C-01, H-01, R-01) with evidence links, signatures, and deployment version number.

**Presenter talk track:**
"Once Angela approves with conditions, Jeeves generates a versioned 'effective controls' record. This is the governance agreement at the moment of deployment: on 2026-07-10, with Angela Torres's approval, this model must have these three controls in place with this evidence. When the model deploys, its deployment version is pinned to this control manifest. If the model gets updated later, a new review cycle opens — new conditions, new controls, new version. This versioning is critical for post-deployment audit: if something goes wrong six months from now, we can ask 'what controls were in effect when this was approved?' and get a deterministic answer."

**Anticipated question:** *"What is the cadence for re-review?"*

**Answer:** "In this demo, redeployment triggers a new review cycle. In M3, we'll add scheduled reviews (e.g., annual recertification). For now, every new model version requires a new approval with current controls. It's conservative, but it locks governance to deployment."

---

## The Loop: Live Breach, Pause, Reassessment (3 min)

### Step 5: Admin Monitor → Breach Detected (1 min)
**On screen:** Different initiative (Member Services Chat Copilot, #4, already deployed). Show telemetry panel (hallucination-rate trend line), synthetic data labeled. Ray Chen (Admin) clicks "Run Monitor" button. Synchronous result: evaluation shows hallucination rate crossed 0.08 threshold on day 9, sustained for 3+ days. Breach triggered.

**Presenter talk track:**
"Member Services Chat Copilot has been deployed for weeks. It's high-tier, member-facing. We monitor its hallucination rate daily — the control Q-01 (Eval Quality Floor) enforces a 0.08 threshold. Watch what happens when Ray Chen, our platform admin, runs the monitor. The rate trend shows a climb starting around day 9, and by day 12 it's sustained above the threshold. Breach detected."

**Anticipated question:** *"Could this have been caught earlier with scheduled monitoring?"*

**Answer:** "Yes — that's M3. Right now, Ray runs the monitor on demand. In production, you'd have continuous feeds from your LLM observability stack (Arize, Phoenix) flowing in automatically. For this demo, we show the on-demand check to keep the story compact. The important part: the breach is detected, audit-logged with a timestamp and Ray's user ID, and the deployment is paused automatically."

---

### Step 6: Deployment Paused, Incident Recorded, Reassessment Opened (1 min)
**On screen:** Initiative card for #4 transitions: state changes to "Paused," incident row appears in audit log showing the breach, a new ReviewCycle opens labeled "Reassessment" (not intake).

**Presenter talk track:**
"Deployment paused — users of the chat model see a graceful hold-message. An incident is recorded in the audit trail: 'Hallucination rate 0.09 sustained 3 days, control Q-01 threshold 0.08 exceeded.' A new ReviewCycle opens, not for approval, but for reassessment. The team that originally approved it now sees a flag: 'Your model is breaching. What happens next?' They can request a new eval, tighten the threshold, retrain, or withdraw the model. Ray can also manually pause and resume deployment with a reason field — both actions audit-log. Admins cannot approve or sign reviews (separation of duties); they can only pause, resume, and change eval thresholds."

**Anticipated question:** *"If an incident fires, who gets notified?"*

**Answer:** "In this demo, the incident appears in the audit trail and the state change is visible on the dashboard. In M2 or M3, you'd wire alerts — email to the Initiative Owner, Slack to the governance channel, ticket to the team. For now, we show the mechanics: pause is idempotent, re-running the monitor doesn't create duplicate incidents, and the audit trail is immutable (append-only at the DB level)."

---

### Step 7: Admin Actions — Threshold Tightening (1 min)
**On screen:** Admin view showing the eval-quality control Q-01. Ray Chen changes the threshold for this initiative from 0.08 → 0.06. A reason field: "Post-breach tightening, high member visibility." An audit event is logged.

**Presenter talk track:**
"Ray tightens the eval threshold from 0.08 to 0.06, reasoning 'Post-breach tightening, high member visibility.' This is one of two live admin actions in the demo. The change is logged with Ray's ID and timestamp. If the model resumes and hallucination rate drifts above 0.06, it will breach again — stricter standard. The other live action: pause/resume deployment, which we showed earlier. That's the admin scope: changing control thresholds and stopping/starting deployments when governance requires it. Admins do not approve initiatives or sign reviews."

**Anticipated question:** *"What prevents an admin from loosening thresholds to let a bad model through?"*

**Answer:** "Audit trail and separation of duties. Every admin action is logged with the admin's ID and reason. Auditors see it. If an audit flags 'Ray loosened threshold without documented justification,' that's a finding. In a hardened system (M4), you'd add approval gates for threshold changes above a delta — but this demo shows the mechanics working: every action is captured, attributable, and reviewable."

---

## Audit Query: Structured Evidence Retrieval (2 min)

**On screen:** Pre-built query interface. Run: "Member-facing initiatives touching PHI, with approver and current control status."

**Results shown:** Four initiatives appear:
- #1 Prior-Auth Clinical Summarizer (live, just approved)
- #3 Social-Sentiment Miner (rejected)
- #4 Member Chat Copilot (paused after breach)
- #9 Formulary Q&A Bot (in review, returned)

Each row links to approver decision, control status, and audit events.

**Presenter talk track:**
"Here's the question an auditor would ask: 'Give me everything member-facing that touches protected health information. Who approved each one, and what's the control status today?' Jeeves runs this as a structured query — no SQL, no data-lake hunting. Four rows: Prior-Auth approved by Angela Torres today with controls C-01, H-01, R-01 in compliance. Sentiment Miner rejected — the Responsible AI and Privacy reviews cite the surveillance and consent policies, and Angela Torres issued the rejection. Chat Copilot deployed but now paused after a breach, controls under reassessment. Formulary Q&A in review — its Responsible AI review was returned for missing bias-testing evidence. Every row links to the approval decision document, the control evidence, and the audit trail. This is the governance record regulators want to see."

**Anticipated question:** *"If a model gets deployed and then pulled offline, can you prove compliance at the time of approval?"*

**Answer:** "Yes. Jeeves pins the governance decision and control manifest to the deployment version. If Prior-Auth v1.0 deployed on 2026-07-10 with approver Angela Torres and controls C-01, H-01, R-01, we have that version locked in. If it later retrains to v1.1, a new approval cycle opens. If v1.0 is pulled offline, the audit record still shows what was approved and when, with evidence links. It's versioned governance."

---

## Fast-Lane Counterpoint (included in steps 1-7 sequence; call out explicitly here for clarity)

**On screen (call back to initiative list):** Marketing Copy A/B Tester (#2) shown as "Approved via fast-lane policy FL-2026-01, approver Angela Torres, deployed."

**Presenter talk track:**
"We've shown a Critical-tier case taking all eight reviews and conditional approval. But not everything is Critical. The Marketing Copy A/B Tester is Low-tier — no PHI, no member-facing output, no care influence. It runs under a pre-approved fast-lane policy FL-2026-01. If it passes completeness check and matches the policy scope, Angela Torres's approval is deterministic — no multi-week review. Speed without losing accountability: Angela's name is on it, and if the policy changes, new submissions must re-qualify. That's the fast-lane story: autonomy for low-risk, full rigor for high-risk, and human accountability throughout."

**Anticipated question:** *"Can the fast-lane policy be gamed to push risky models through?"*

**Answer:** "Only if the policy itself is wrong. The policy is a business document, not an algorithm — it's owned by your governance team and reviewed with your risk-and-compliance officer. Jeeves enforces it deterministically, but it's written by humans. If you write 'all Low-tier models auto-approve,' and someone submits a PHI-touching model as Low-tier, the triage rule will catch it — triage forces it to High, and fast-lane eligibility fails. The triage rules are non-negotiable; the policies are tunable."

---

## Closing: Governance Speed + Accountability (1 min)

**On screen:** Dashboard showing the full portfolio, one incident paused, one rejection, one conditional approval, one fast-lane approval.

**Presenter talk track:**
"Jeeves turns AI governance from a once-per-year gate review into a continuous closed-loop: intake → triage (deterministic) → multi-domain review (agent-drafted, human-signed) → conditional approval (named accountable approver) → deployment (versioned, pinned controls) → live monitoring (continuous breach detection) → incident → reassessment. Speed: a Low-tier model approves in hours. Rigor: a Critical model requires eight domain sign-offs and continues under monitoring. Accountability: every decision, every approver, every control status is logged and auditable. We're not replacing your governance; we're making it fast, visible, and defensible."

**Next milestone callout:**
"The roadmap is ambitious. All eight domains are already drafted live, as you just saw — M2 adds conversational intake on top of that breadth. M3 (following 3 days) brings real Arize/Phoenix feeds and interactive RL promotion. M4 (final hardening) adds the full control catalog UI, exception workflows, and a security-reviewer pass. All synthetic data in this demo — if you move to production, you'd wire your real member data and model systems. But the governance design you see here is the production template."

**Anticipated final question:** *"Is this real member data?"*

**Answer:** "No. All synthetic, fictional Meridian Health, deterministic PRNG seed. For a real deployment, you'd connect your actual model observability stack (Arize, Phoenix, or your LLM provider's built-in telemetry), swap in your real initiatives and actors, and keep the same governance logic. The demo is a template; the governance skeleton is production-ready."

---

## Close (1 min — optional post-Q&A)

**On screen:** Simple title slide: "Jeeves — Governance as a Checkpoint, Not a Gate."

**Presenter:** "Questions?"

---

## Key Talking Points for Anticipated Q&A

| Question | Answer |
|---|---|
| **Is this a real system?** | Real governance design, synthetic data, fictional payer. Production-ready logic; you'd wire your live data. |
| **What if an agent drafts badly?** | Humans review, sign, or return. Agents advise; humans decide. Accountable approvers sign off. |
| **Who's accountable?** | Named accountable approver on every approval (Angela Torres in this demo). Audit trail logs every action and actor. |
| **Can users exploit the fast-lane?** | Only if the policy is wrong. Triage rules are hardcoded and non-negotiable; policies are business-owned and tunable. |
| **How do you handle continuous redeployment?** | Every model version pins to a governance decision and control manifest. New version = new review cycle. Versioned, locked. |
| **What's the post-demo roadmap?** | All 8 domains already drafted live today. M2: conversational intake. M3: real LLM observability feeds. M4: full control catalog + hardening. |
| **Is the audit query really that simple?** | Yes. Structured query, no SQL, deterministic results, evidence links. Auditors see what they need in seconds. |
| **Who prevents an admin from loosening controls?** | Audit trail + separation of duties. Admin actions are logged and attributable. Loosening without justification is a compliance finding. |

---

**End of script. Approximate word count: 2,250 words.**
