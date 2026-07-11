# Jeeves — UI Specification

**Status:** Draft for review. Companion to `plan.md` (§2 champion storyline, §3 public-safety model, §13 milestones) and `docs/seed-spec.md` (actors, initiatives, controls, telemetry, outcome metrics, audit queries).
**Author:** Sonnet (UI worker), reviewed by Claude (orchestrator).
**Scope:** M1 champion vertical UI. M2/M3/M4 slot-ins are called out inline where relevant, not designed in full.

---

## 0. Design principle

**One initiative-centric application, not five role apps.** There is a single set of routes. The role switcher in the global chrome (§7) changes:

- which **actions** render (e.g., "Sign review" only for Reviewer; "Change threshold" only for Admin),
- which **saved views** are pinned on Home and Audit,
- nothing else. Every role sees the same initiative list, the same detail page, the same tabs. No route is role-scoped (no `/reviewer/*`, no `/admin-only-dashboard`). This mirrors Sierra's pattern of one product surface with contextual affordances, per plan §1/§2 (Codex F8).

Roles (fictional, from seed-spec §1): **Requester** (Priya Raman, Dan Kowalski), **Reviewer** (Dr. Elena Vasquez, Marcus Webb, Sofia Grant, James Liu), **Program Office** (Nia Okafor), **Audit/Leadership** (reads everything, approves nothing — Angela Torres also reviews audit views in her VP capacity), **Admin** (Ray Chen). The role switcher is a demo convenience (no real auth in M1 per plan §11) — switching role is instant and client-side; it does not re-fetch a different data set, only a different action/view configuration.

---

## 1. Route map

| Route | Screen | Primary entities read |
|---|---|---|
| `/` | Home / portfolio command center | Initiative, RiskAssessment, DeploymentVersion, Observation (rollups), EffectiveControl, AuditEvent (recent), outcome-metric rollups |
| `/initiatives/[slug]` | Initiative detail (tabs: Overview, Intake, Reviews, Decisions, Controls, Operate, Audit) | Initiative, IntakeVersion, RiskAssessment, ReviewCycle, ReviewDecision, DeploymentVersion, EffectiveControl, Observation, Incident, AuditEvent |
| `/initiatives/new` | Intake flow | IntakeVersion (draft), ControlDefinition (for preview), triage rules (client-displayed) |
| `/reviews` | Review workbench (queue + drafting surface) | ReviewCycle, ReviewDecision, Initiative (summary), policy citations (static corpus) |
| `/audit` | Audit query console | AuditEvent, ReviewDecision, EffectiveControl, Initiative (joined) |
| `/admin` | Admin console | ControlDefinition (Q-01 only, live), DeploymentVersion (pause/resume), AuditEvent (control-change log), RunBudget |

No route requires a role param; role is a client-side context (`useRole()`), not a URL segment, so a Program Office user and a Reviewer looking at `/initiatives/prior-auth-summarizer` are on the identical URL with different visible actions. This also keeps the public read-only mode (§7) a single flag rather than a route split.

---

## 2. Home / portfolio command center — `/`

**Purpose:** the "champion demo" landing screen and the Program Office's daily view — portfolio health at a glance, then drill into any initiative.

**Layout (top to bottom):**

1. **Chrome banner** (see §7) — "Fictional demo — synthetic data," role switcher, passcode entry if in read-only mode.
2. **Outcome-metrics strip** — 5 cards/badges in a horizontal row (Recharts sparkline behind each number where seed-spec §6 implies a trend, otherwise a plain stat card):
   - Review cycle time (median ~11d) — sparkline of recent cycle times, champion case annotated once it closes faster.
   - First-pass completeness rate (~60%) — donut or simple percentage badge.
   - Reviewer hours saved (drafted-vs-scratch estimate) — stat card, "~4h/review" subtext.
   - Evidence freshness (10/12 fresh) — badge with fraction + red dot for stale count.
   - Overdue controls (3) — badge, click-through filters the pipeline board below to the 3 offending initiatives (#10, #11, #9).
   Each card carries a small "i" tooltip: "Computed from seeded/live data — see Audit tab for source events." No connector chip needed here (these are our own computed metrics, not vendor telemetry — seed-spec §6 distinguishes this from §4 telemetry honesty rules).
3. **Pipeline board** — Kanban-style board, columns = lifecycle states (Intake → Triaged → In Review → Conditionally Approved / Approved → Deployed → Paused → Rejected). Cards = initiatives, showing slug, tier badge, accountable approver avatar/initials, and a small state-age indicator ("14d in review"). Column header shows count. This is the seed-spec-driven pipeline: all 12 initiatives render here at their seeded lifecycle state; the champion (#1) starts in "Intake" and visibly moves rightward across the demo.
4. **Risk heatmap** — grid, rows = tier (Critical/High/Medium/Low), columns = domain status (e.g., "All signed," "In progress," "Blocked/Returned," "Overdue"). Cell = count + color intensity; click cell filters pipeline board below (or opens a filtered list). Built with a simple table + Tailwind color scale (a full Recharts heatmap is optional — a styled `<table>` with badge-colored cells is acceptable and cheaper to build; note this as an implementation choice, not a requirement).
5. **SLA / bottleneck callouts** — a short list/card row: "3 controls overdue," "1 review returned >5d ago (#9 formulary-qa-bot)," "1 reassessment pending (#4)." Each is a link straight into the relevant initiative's tab (Controls, Reviews, or Operate respectively).
6. **Role-aware saved views** — a row of filter chips above or beside the pipeline board, e.g.:
   - Requester: "My initiatives" (Priya's / Dan's).
   - Reviewer: "My queue" (assigned domain reviews awaiting signature) — deep-links to `/reviews`.
   - Program Office: "At risk" (overdue + returned + paused), "This week's SLA breaches."
   - Audit/Leadership: "Everything approved by Angela Torres," "PHI + member-facing" (mirrors seed-spec §7 queries 1–2) — deep-links to `/audit` with the query pre-run.
   - Admin: "Paused deployments," "Recent control changes."
   These are just saved filter presets on the same board/heatmap, confirming the "one UI, different views" principle.

**Data shown:** Initiative (slug, title, tier, state, accountable approver), RiskAssessment (tier), DeploymentVersion (state: active/paused), Observation rollups (for the "trending up" badge on #4), EffectiveControl (status counts for heatmap), AuditEvent (most recent N for callouts), computed outcome metrics (seed-spec §6).

**Actions per role:**
- Requester: "New initiative" primary button (→ `/initiatives/new`); click own cards.
- Reviewer: "My queue" saved view → `/reviews`; no mutation actions on this screen.
- Program Office: filter/sort controls, export nothing (no live export in M1), click-through only.
- Audit/Leadership: saved views → `/audit`; read-only everywhere.
- Admin: "Paused deployments" saved view → highlights any paused card with a "Resume" quick-action button inline (only admin sees this button on the board itself; everyone else sees a plain "Paused" badge).

**States:**
- *Loading:* skeleton cards for outcome strip (5 shimmering boxes), skeleton columns for pipeline board.
- *Empty:* not reachable in the demo (seed always populates 12 initiatives) — but the board renders an empty-column state ("No initiatives in Rejected") gracefully per column since #3 is the only rejected one and other columns could theoretically be empty in a reset workspace.
- *Read-only public:* all click-throughs to detail pages still work (read is always allowed); "New initiative" button is disabled with tooltip "Enter demo passcode to create initiatives" (§7); admin quick-actions (Resume) are hidden entirely, not just disabled, for non-admin/public.
- *Paused:* any card representing a paused deployment (initiative #4 mid-demo) gets a distinct amber left-border + "Paused" badge instead of "Deployed," and surfaces in the SLA callout list.
- *Breach:* not a Home-level state per se — the breach is discovered via Operate tab / triggered via Admin "Run monitor" — but once fired, initiative #4's card flips to "Paused" with a small red incident icon, and a new SLA callout appears: "Incident opened — #4 member-chat-copilot."

**Demo money-shot:** the pipeline board visibly containing all 12 initiatives in different real lifecycle states (not a mockup — actual seeded diversity), plus the outcome-metrics strip proving this is about outcomes, not vanity activity counts. The moment the breach fires later in the demo and the presenter returns to `/`, initiative #4's card visibly flips state live — that's the "it's a real system, not slides" beat.

---

## 3. Initiative detail — `/initiatives/[slug]`

**Purpose:** the single source of truth for one initiative's full governance lifecycle. Every persona ends up here — it's the most-visited screen in the demo.

**Header (persistent across tabs):**
- Title + slug, **tier badge** (Critical/High/Medium/Low, color-coded — red/orange/yellow/green or similar), **lifecycle state badge** (Intake / Triaged / In Review / Conditionally Approved / Approved / Deployed / Paused / Rejected), **accountable approver** (name + role, e.g. "Angela Torres — VP, AI Governance"), overlay-flag chip row (PHI, member-facing, care/coverage, vendor-hosted, human-in-loop, individual-impact — small icon+label chips, from seed-spec §2.1).
- Tab bar: **Overview | Intake | Reviews | Decisions | Controls | Operate | Audit**.

### 3.1 Overview tab
Summary card: title, description, requester, tier + derivation reasoning (which overlay flags triggered which rule, e.g. "care-coverage ∧ ¬human-in-loop → Critical"), required domains list with per-domain status pills (drafted/signed/returned/not started), current deployment version if any, links to jump straight to Reviews/Decisions/Controls/Operate for anything outstanding. This is the "read this and understand the whole initiative in 20 seconds" tab.

### 3.2 Intake tab
Read-only rendering of the submitted `IntakeVersion`: the 6 overlay-question answers (seed-spec §2.1), free-text description, data-retention answer (flagged if missing — this is the champion's completeness-check beat), submission timestamp, submitter. If intake is still in draft (champion #1 before the demo runs it live), shows "Draft — not yet submitted" state and a "Continue intake" button (Requester role only) linking to `/initiatives/new?draft=<slug>`.

### 3.3 Reviews tab
Per-domain status list/table: domain name, status (not started / drafted / signed / returned), assigned reviewer (from seed-spec §1), last-updated timestamp, and for signed/returned rows a link to the decision text. Reviewer role sees a **"Sign off"** action on any drafted review assigned to them, and a **"Return"** action with a mandatory reason field (mirrors #9's returned-review storyline). Non-reviewers see the same table read-only. Clicking a domain row expands/links into the same drafting surface used at `/reviews` (§4) — the tab is a filtered view of that workbench scoped to this initiative, not a separate UI.

### 3.4 Decisions tab
List of `ReviewDecision` records (final, cross-domain outcome plus the accountable approver's overall decision): approved / conditionally approved / rejected, approver name, date, and — critically — **conditions** for conditional approvals (initiative #8's two conditions: human-review sampling rate, escalation protocol), each condition linked to the `EffectiveControl` it maps to. Rejected initiatives (#3) show the full rejection rationale with policy citations (e.g., MP-H-5.1(b), MP-R-5.1(a), MP-L-6.1(b) per `docs/policies/INDEX.md`). Fast-lane approvals (#2) show a distinct "Approved via Fast-Lane Policy FL-2026-01" badge with the accountable approver still named (Angela Torres) — visually reinforcing that fast-lane is a named-accountability shortcut, not an autonomous approval.

### 3.5 Controls tab
Table of `EffectiveControl` rows generated for this initiative's deployment: control id/name, domain, enforcement mode (monitor/gate/block), cadence, evidence status (current/stale/missing), owner, and — for Q-01 specifically — the live threshold value and a "view series" link into Operate. Overdue controls (per initiative #10, #11, #9) show a red "Overdue" badge with remediation owner. Exception requests (initiative #11) show a distinct "Exception pending" badge instead of red — this is a different state, not a violation (M4 will add a full exception workflow; M1 renders it as a status only).

### 3.6 Operate tab
Cost / eval / GPU panels, built from `Observation` series (seed-spec §4). **Every panel is labeled "Synthetic data — demo" with a connector-status chip** ("Arize: not connected") per plan §7/Codex F6 — no exceptions, no panel implies a live vendor integration that doesn't exist.
- **Cost panel:** daily token-cost line chart (Recharts `LineChart`) — shown for any deployed initiative with a cost series (e.g., #4 ramping $80→$140/day).
- **Eval panel:** hallucination-rate / relevance line chart with the Q-01 threshold rendered as a horizontal reference line (Recharts `ReferenceLine`). For #4, the line visibly crosses 0.08 around day 9 and stays above — this is the panel the presenter watches during the breach beat. For #5, instead of a live drift line, render a **v2.0 → v2.1 offline eval comparison** (bar or grouped-bar chart) plus a "Promotion gate: awaiting feedback-provenance sign-off" banner — this is the RL/version-promotion story, explicitly not a training dashboard (plan §5).
- **GPU panel:** only rendered for initiative #6 (`claims-ocr-coder`, the one self-hosted workload) — utilization sinusoid with an 80% quota reference line. Absent entirely (not zeroed-out) for every other initiative, since GPU utilization is only meaningful for the one self-hosted deployment (seed-spec §4).
- **Budget/rate context:** a small `RunBudget` status line near the cost panel if this initiative consumed live-demo budget (relevant mainly if a visitor is in passcode/live mode).
- Admin-only inline action: **"Run monitor"** button (also available at `/admin`, duplicated here for narrative convenience during the champion walkthrough) — synchronously evaluates Q-01 against the observation series; idempotent (re-running creates no duplicate incident, per plan §8 test 5). On breach, this tab's eval panel gets a red annotation marker at the threshold-crossing point and the header's lifecycle badge flips to "Paused."

### 3.7 Audit tab
Chronological `AuditEvent` timeline for this initiative only: intake submitted → triage classified (rule inputs shown) → reviews drafted/signed/returned → decision recorded (approver + conditions) → deployment created → control attestations → (if applicable) threshold breach → pause → reassessment cycle opened. Each event is a timeline row with actor, timestamp, event type, and a short structured detail (e.g., "Triage: PHI=Y, member-facing=Y, care-coverage=Y, human-in-loop=N → Critical"). This tab is also the drill-down target from `/audit` query results.

**Actions per role (all tabs considered together):**
- Requester: continue/edit intake (draft only), view everything else read-only.
- Reviewer: sign/return on Reviews tab for their assigned domain(s) only; read-only elsewhere.
- Program Office: read-only everywhere; primary consumer of Overview + Controls + Operate.
- Audit/Leadership: read-only everywhere; primary consumer of Decisions + Audit tabs.
- Admin: "Run monitor" (Operate tab) and nothing else on this page — **no approve/sign/return button ever renders for Admin, on any tab, by design** (separation of duties, plan §2 step 8).

**States:**
- *Loading:* header skeleton + tab-content skeleton (table/card placeholders per active tab).
- *Empty:* Reviews tab for a freshly-triaged initiative with no drafts yet shows "No reviews drafted yet" with required-domains checklist instead of a table.
- *Read-only public:* Sign/Return/Continue-intake/Run-monitor buttons are hidden (not just disabled) for unauthenticated public visitors per plan §3 ("no unauthenticated mutation endpoint exists"); a small inline note replaces them: "Sign in with demo passcode to take actions."
- *Paused:* header badge "Paused" in amber/red; Operate tab shows a persistent banner "Deployment paused — [reason] — opened Incident #… — Reassessment ReviewCycle in progress" with a link to the new ReviewCycle's Reviews tab entries.
- *Breach:* the specific moment-of-crossing state — Operate tab's eval chart shows the reference-line crossing annotated in red, plus a banner "Eval quality floor breached (Q-01): hallucination rate 0.081 ≥ 0.08 sustained 3 points" that appears immediately after "Run monitor" fires, before the page-level Paused state is even reflected elsewhere — this is intentionally the most detailed state in the whole spec since it's the demo's climax.

**Demo money-shot:** watching the *same* Operate tab, on the *same* initiative, go from a normal-looking eval line chart to a red-annotated breach banner to a "Paused" header badge to a new reassessment ReviewCycle appearing on the Reviews tab — all from one click of "Run monitor" — proving state transitions are real and connected, not staged screens.

---

## 4. Intake flow — `/initiatives/new`

**Purpose:** structured intake for a new initiative (the champion's step 1). Explicitly **not** a chat interface in M1 — plan §11 defers the conversational version to M2, and this spec should make the slot-in point clear so M2 doesn't require a rewrite.

**Layout:**
1. Chrome banner + "New Initiative" title.
2. **Basic details section:** title, one-line description, requester (auto-filled from active role if Requester, else a picker for other roles filling in on someone's behalf — matches seed-spec's Priya/Dan requester pairing).
3. **The 6 overlay questions** (seed-spec §2.1), each rendered as a clear yes/no toggle or radio with a short helper line explaining why it matters:
   1. Does it access PHI?
   2. Do members interact with or receive its output directly?
   3. Does it influence care or coverage decisions?
   4. Is the model vendor-hosted?
   5. Does a qualified human review each output before it takes effect?
   6. Does it affect individuals' opportunities, rights, or services?
4. **Data-retention question** — a required free-text/select field (this is the field the champion's completeness check flags as missing when left blank — plan §2 step 1).
5. **Live tier preview panel** (sidebar or inline card) — as the user answers the 6 questions, this panel recomputes and displays the resulting tier + required domains in real time, using the same rule logic as `lib/triage/rules.ts` (client mirrors server rule so the preview never contradicts the server-side triage that runs on submit). Shows the rule that matched (e.g., "Rule 1: care-coverage ∧ ¬human-in-loop → Critical").
6. **Completeness meter** — a progress indicator (e.g., "5 of 6 required fields complete") that turns red/incomplete when the data-retention field is blank, with inline messaging: "Missing: data-retention answer. Intake cannot be submitted until complete." This is the literal UI surface for the champion's "completeness check flags a missing data-retention answer" beat.
7. **Submit button** — disabled until completeness meter is 100%; submitting creates the `IntakeVersion`, runs server-side triage, and redirects to `/initiatives/[slug]` (Overview tab) showing the new tier badge and required-domains checklist.

**M2 slot-in note:** the conversational intake chat (plan §11) replaces this form's steps 3–4 with a chat panel that asks the same 6 questions plus the retention question conversationally, then populates the identical `IntakeVersion` fields and hands off to the same live tier-preview panel and completeness meter — i.e., M2 swaps the *input surface*, not the underlying data model or the preview/completeness components. Recommend building the tier-preview and completeness-meter as standalone components now so M2 can reuse them unchanged.

**Actions per role:** Requester is the primary actor (create/submit). Other roles can view a submitted intake (via the Intake tab, §3.2) but `/initiatives/new` itself is only meaningfully actionable for Requester — for other roles the form still renders (no route-level role gate, per §0) but a banner reads "You are viewing intake as [Role] — only Requesters typically submit new initiatives" with submit still technically available (no hard role lock in the demo, since this is a demo not a production RBAC system) unless public read-only mode is active.

**States:**
- *Loading:* n/a (client-rendered form, no async load before interaction).
- *Empty:* default state — all 6 toggles unset, tier preview shows "Answer all questions to see tier," completeness meter at 0%.
- *Read-only public:* entire form disabled with a banner: "Enter demo passcode to create a new initiative" — form fields render (so visitors can see the questions) but are non-interactive, and Submit is replaced with a disabled button + tooltip.
- *Paused / Breach:* not applicable to this screen (pre-lifecycle).

**Demo money-shot:** the live tier-preview panel flipping to "Critical — all 8 domains required" the instant the presenter answers "care-coverage = Yes, human-in-loop = No," making the deterministic triage rule visible and legible in real time, then the completeness meter catching the missing retention field before submit is even possible — governance-by-design, not governance-by-afterthought.

---

## 5. Review workbench — `/reviews`

**Purpose:** the reviewer's home base — see everything assigned across all initiatives, then drill into any one review to draft/edit/sign/return. This is also where the Initiative detail Reviews tab (§3.3) links back to when a reviewer wants full drafting context.

**Layout:**
1. Chrome banner.
2. **Reviewer queue** (top section) — table/list across all initiatives: initiative title/slug, tier, domain, status (drafted/signed/returned/not started), assigned reviewer, age ("3d since drafted"). Filterable by domain and status; default filter for a Reviewer-role user is "assigned to me." Program Office / Audit see the full unfiltered queue read-only (useful for spotting bottlenecks — e.g., #9's returned RAI review sitting unresolved).
3. **Drafting surface** (appears on selecting a queue row; can be a side panel or a dedicated sub-view within the same page — recommend a two-pane layout so the queue stays visible):
   - **Left pane — agent draft + policy citations (read-only reference):** the eve-generated draft assessment text, plus a citations list linking to the specific policy sections (`docs/policies/*.md` anchors, e.g., MP-R-2.4 for #9's bias-testing gap) that the draft cites. For the 4 domains that are pre-seeded rather than live-drafted (per plan §1's "3–4 implemented as live agent drafts, rest seeded"), this pane shows the seeded draft text identically — no visual distinction is exposed to the reviewer, since the point is the review workflow, not which drafts are "real" agent calls; a small dev-only badge may exist but should not be part of the polished demo view.
   - **Right pane — editable assessment:** a text area pre-populated from the draft (reviewer edits it — this is the "reviewer edits a draft" beat from plan §2 step 3), a structured verdict selector (sign / return), and for "return," a mandatory reason field. Below that, **Sign** and **Return** buttons (Reviewer role only; visible-but-disabled with tooltip for all other roles, since the drafting surface itself is useful read context for Program Office/Audit even if they can't act on it).
4. Signing writes a `ReviewDecision` state change (drafted → signed) and an `AuditEvent`; returning writes (drafted → returned) plus the reason, also audited. Both actions are idempotent per plan §8 test 5 (duplicate signature attempts rejected with a clear inline error, not a silent no-op).

**Data shown:** ReviewCycle, ReviewDecision (status, domain, reviewer, timestamps), Initiative (slug/title/tier for context), static policy-citation corpus (`docs/policies/`).

**Actions per role:**
- Reviewer: sign, return (with reason), edit draft text before signing.
- Requester: read-only — useful for seeing why their initiative is stuck.
- Program Office: read-only, primary use is bottleneck-spotting (this is the source of the Home screen's "1 review returned >5d ago" callout).
- Audit/Leadership: read-only.
- Admin: read-only — reinforces separation of duties (no sign/return ever available to Admin, consistent with §3.3 and §6).

**States:**
- *Loading:* skeleton rows in queue, empty drafting pane with "Select a review" placeholder.
- *Empty:* "Your queue is empty" for a reviewer with nothing assigned (not the champion's actual seed state, but a legitimate reachable state after all champion reviews are signed).
- *Read-only public:* drafting surface renders fully (so visitors can see how review drafting works) but Sign/Return are disabled with tooltip "Enter demo passcode to act as a reviewer."
- *Paused:* a review row belonging to a reassessment ReviewCycle (opened after #4's breach) shows a distinct "Reassessment" tag distinguishing it from the initial cycle's reviews.
- *Breach:* not directly surfaced here except via the reassessment row appearing after the breach fires elsewhere (Operate tab / Admin "Run monitor").

**Demo money-shot:** the two-pane drafting surface — agent draft with real policy citations on the left, human editing and taking accountability on the right — makes the "agents draft, humans decide" autonomy model (plan §1, Codex F3) tangible in a single screenshot. This is the strongest visual argument that agents never hold approval authority.

---

## 6. Audit query console — `/audit`

**Purpose:** the Audit/Leadership role's primary screen — prove that every governance claim is backed by evidence-linked, queryable data. Directly implements seed-spec §7's 4 canned queries plus ad hoc filtering.

**Layout:**
1. Chrome banner.
2. **Canned query chips** — 4 one-click chips matching seed-spec §7 exactly:
   - "Member-facing initiatives touching PHI" (→ #1, #3, #4, #9 with approver + control status)
   - "Everything approved by Angela Torres" (→ decisions with links)
   - "Overdue controls" (→ the 3, with remediation owners)
   - "What changed on Q-01 and who changed it" (→ the base−30d admin threshold-change event)
   Clicking a chip runs the query immediately and populates the results table below; the chip stays visually "active" until cleared.
3. **Filter builder** — below/beside the chips, a simple structured filter row (not free-text NL search in M1 — that's the M2 "ask-the-auditor" deferred feature per plan §11): dropdowns/multi-selects for tier, domain, state, approver, date range, overlay flags (PHI/member-facing/etc.). Filters compose with a canned query (e.g., click "Everything approved by Angela Torres" then further filter to tier=Critical) or run standalone.
4. **Results table** — rows = matched records (decisions, events, or controls depending on query shape), columns adapt to query type but always include at minimum: initiative, event/decision type, actor, timestamp, and an **evidence link** — clicking any row deep-links into that initiative's Audit tab (§3.7) at the specific event, or into Decisions/Controls tab as appropriate. This is the "evidence-linked" promise made concrete: nothing in this table is a dead end.
5. **Query explanation strip** (small, below the chips) — plain-language restatement of the currently active query/filters, e.g. "Showing: initiatives where member-facing = Yes AND PHI = Yes" — reinforces that these are structured, explainable queries, not opaque search.

**M2 slot-in note:** the free-form "ask-the-auditor" NL chat (plan §11) is explicitly documented as grounded on this same structured query layer — i.e., NL input gets parsed into the same filter-builder parameters and produces the same results-table + evidence-link output. Recommend keeping the filter-builder's parameter shape and the results-table renderer as reusable components for that reason.

**Data shown:** AuditEvent (append-only, DB-level enforced per plan §5), ReviewDecision, EffectiveControl, Initiative — all joined for query display.

**Actions per role:**
- Audit/Leadership: primary user — run any canned query or ad hoc filter, no mutation actions exist on this screen for anyone (audit is inherently read-only).
- Program Office: same read access, useful for the "overdue controls" query specifically.
- All other roles: fully accessible read-only (there is no reason to hide audit data from any role in this demo — governance transparency is the point).
- Admin: same read access; separately, the "What changed on Q-01" query is the natural place to demo where Admin's own threshold-change actions become permanently auditable (reinforcing that Admin's power is narrow but logged).

**States:**
- *Loading:* skeleton rows in results table while a query runs (should be near-instant against seed data, but skeleton exists for the live-demo-workspace case where a query might hit a larger session dataset).
- *Empty:* a filter combination with zero matches shows "No records match this query" with a suggestion to broaden filters — reachable state, should look intentional not broken.
- *Read-only public:* fully available — audit query is read-only by nature, so this screen behaves identically for public visitors and passcode users (one of the few screens with no gated actions at all).
- *Paused / Breach:* the "Overdue controls" and general filters surface breach-related events naturally (e.g., filtering to initiative #4 after breach shows the pause/incident/reassessment events) but there's no distinct page-level state — this screen always just reflects current data.

**Demo money-shot:** running "What changed on Q-01 and who changed it" live and landing on the exact base−30d event where Ray Chen tightened the threshold from 0.10→0.08 with reason "Q2 quality initiative" — this is the seed-spec's deliberate foreshadowing payoff, and clicking through from that event to the later breach makes the causal chain (tighter threshold → real breach 30 days later) visible in two clicks.

---

## 7. Admin console — `/admin`

**Purpose:** the narrowest screen in the app by design — exactly two live mutable actions, both logged, with **visually enforced separation of duties** (no approve/sign action ever renders here, or anywhere, for Admin).

**Layout:**
1. Chrome banner.
2. **Action 1 — Q-01 threshold edit card:** shows current threshold per tier (High default 0.08, Critical default 0.05, per seed-spec §3) and any deployment-level overrides. "Edit threshold" button opens a dialog: new value input, **mandatory reason field** (cannot submit without text), preview of which deployments this affects, Confirm/Cancel. On confirm, writes an `AuditEvent` (control-change type) and updates the effective control. This is the same action-shape as the historical seeded event (Ray Chen, 0.10→0.08, "Q2 quality initiative," base−30d) — the UI should make that historical precedent visible right on this card ("Last changed: 30 days ago by Ray Chen — 'Q2 quality initiative'") so the live action reads as a continuation of a real audit trail, not a one-off demo button.
3. **Action 2 — Pause/Resume deployment card:** a searchable/selectable list of active deployments; each row has a "Pause" (or "Resume" if already paused) button. Clicking opens a dialog: **mandatory reason field**, Confirm/Cancel. On confirm, writes an `AuditEvent`, updates `DeploymentVersion` state, and (if pausing) surfaces the same paused-state UI described in §3 Operate tab. This is also the mechanism the champion breach uses when the presenter manually pauses (or the automated monitor pauses on Q-01 breach — see "Run monitor" below).
4. **Run monitor button** — a distinct, clearly-labeled action ("Run monitor now") that synchronously evaluates Q-01 against current Observation data for all deployments and applies pause+incident+reassessment if a breach condition is met. This is the actual trigger for the champion's breach beat (plan §2 step 5). Idempotent — re-running when already breached/paused does nothing further and shows a confirmation toast "No new breaches detected" rather than erroring or duplicating.
5. **Control-change audit log** (bottom section) — a filtered view of AuditEvents scoped to control-change and deployment-state-change events only (i.e., exactly the events this page can produce), so Admin's own action history is immediately visible on the same page — reinforcing "everything Admin does is logged, nothing more, nothing less."

**Visually enforced separation of duties:** no button on this page, or anywhere else in the app when Admin role is active, ever reads "Approve," "Sign," "Return," or similar. This isn't just a permissions check hidden behind a disabled state — those buttons **do not render at all** for Admin (contrast with public read-only mode, where mutation buttons render disabled-with-tooltip; Admin's non-actions are simply absent, because the point being demonstrated is architectural role narrowness, not a permission the role technically has but is blocked from using). Recommend a code-level convention (e.g., an `ADMIN_ACTIONS` allowlist rather than a `NON_ADMIN_ACTIONS` blocklist) so this is structurally hard to violate by accident.

**Data shown:** ControlDefinition (Q-01 only — no other control gets a live-edit surface, per plan §6: "everything else renders honestly as catalog + status"), DeploymentVersion (state, pause history), AuditEvent (control-change + state-change subset), RunBudget (if relevant to display alongside "Run monitor" — e.g., a small note if monitor runs are rate-limited in live-demo mode).

**Actions per role:**
- Admin: both live actions + Run monitor — the only role with any mutation capability on this page.
- All other roles: page is fully visible read-only (seeing the current threshold and deployment states is useful context for Program Office/Audit) but all three action buttons are hidden (not merely disabled) for non-Admin roles, same rationale as above but mirrored — this page has real actions that must not leak to other roles, so the same "don't render" convention applies symmetrically.

**States:**
- *Loading:* skeleton cards for both action panels.
- *Empty:* n/a — Q-01 and at least one deployment always exist in seed data.
- *Read-only public:* both dialogs are unreachable — buttons hidden with a banner: "Admin actions require demo passcode + Admin role."
- *Paused:* the pause/resume card is the literal source of truth for this state — a paused deployment shows "Resume" instead of "Pause," with the original pause reason displayed inline.
- *Breach:* immediately after "Run monitor" detects a breach, this page shows a success/alert toast ("Breach detected on member-chat-copilot — deployment paused, incident #… opened, reassessment cycle #… created") and the pause/resume card updates live to reflect the new paused state without a full page reload.

**Demo money-shot:** clicking "Run monitor" and watching the toast announce the full cascade (breach → pause → incident → reassessment) in one sentence, then the audit log at the bottom of the same page immediately showing the new event rows — the whole governance consequence of a threshold crossing, visible on one screen, with zero approve/sign buttons anywhere in sight.

---

## 8. Global chrome

**Persistent across all routes:**

1. **Top banner:** "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization." Always visible, non-dismissible (or dismissible-but-reappears-per-session — recommend non-dismissible given plan §3's public-safety emphasis).
2. **Role switcher:** a dropdown/segmented control in the header — Requester / Reviewer / Program Office / Audit-Leadership / Admin. Switching is instant, client-side, and re-renders available actions + saved views per §0; it does not change the underlying data or require a page reload beyond re-evaluating which buttons/views show.
3. **Demo mode indicator + passcode entry:** a small chip showing "Read-only (public)" or "Live demo (session workspace)." Clicking it when in read-only mode opens a passcode entry dialog (per plan §3): on correct passcode, the session transitions to an isolated, resettable demo workspace with mutation enabled, subject to per-day token budget, input-length limits, and per-IP rate limiting (all enforced server-side; the UI's job is to surface remaining budget/rate-limit state gracefully, e.g., a small "Demo budget: 42/50 actions today" indicator once live, and a clear error toast rather than a silent failure if a rate limit is hit).
4. **Public read-only mode behavior (cross-cutting rule):** every mutation-capable button in the entire app (Submit intake, Sign, Return, Run monitor, Edit threshold, Pause/Resume) follows one consistent pattern when in public read-only mode: the button remains visible (so the read-only visitor can see what actions exist) but is disabled with a tooltip "Enter demo passcode to enable this action." This is distinct from the role-based hide-entirely pattern in §6/§7 (Admin approve-buttons don't exist at all, for anyone) — read-only-mode disabling is about authentication state, role-based hiding is about architectural separation of duties. Keep these two mechanisms conceptually and, ideally, componentized separately (`<GatedAction requiresAuth>` vs. role-conditional rendering) so they don't get conflated in implementation.
5. **Global nav:** Home, Initiatives (maybe just via Home's board — a lightweight "browse all" link if a flat list is useful), Reviews, Audit, Admin — a simple header nav, visible to all roles (again, no route hiding; Admin nav item is visible to a Requester-role viewer too, since there's no real auth boundary in the demo, only an action-visibility one once *inside* that page).

---

## 9. Shared component inventory

**shadcn/ui components used across multiple screens** (confirms available: button, card, table, badge, tabs — plus recommended additions):
- `button` — everywhere (primary actions, quick-actions, dialog triggers).
- `card` — outcome-metrics strip, Overview tab summary, Admin action panels, Operate panels.
- `table` — Reviews queue, Audit results, Controls tab, Admin control-change log.
- `badge` — tier badges, lifecycle-state badges, evidence-status pills, connector-status chips, "Synthetic data — demo" labels.
- `tabs` — Initiative detail's 6-tab layout.
- **Recommended additions:**
  - `dialog` — mandatory-reason dialogs (Admin threshold edit, pause/resume, review return), passcode entry.
  - `tooltip` — disabled-button explanations (read-only mode, role gating).
  - `select` / `dropdown-menu` — role switcher, filter builder dropdowns.
  - `toast` (via `sonner` or shadcn's toast primitive) — Run monitor results, sign/return confirmations, rate-limit errors.
  - `progress` — completeness meter on intake, GPU/budget bars.
  - `separator` — visual grouping within dense tabs (Controls, Audit timeline).
  - `skeleton` — loading states throughout.
  - `alert` — breach banners, paused-deployment banners, exception-pending banners.
  - `avatar` — actor initials on pipeline board cards and audit timeline rows.
  - `command` (cmdk-style) — optional, for the Audit filter builder if it grows a searchable-picker need; not required for M1.

**Custom components (recur across ≥2 screens):**
- `TierBadge` — consistent tier coloring (Critical/High/Medium/Low) used on Home board, Initiative header, Intake preview, Audit results.
- `LifecycleBadge` — state coloring (Intake/Triaged/In Review/Conditional/Approved/Deployed/Paused/Rejected) used on Home board, Initiative header, Reviews queue.
- `AccountableApproverChip` — name + role + avatar, used on Home cards, Decisions tab, Admin threshold-history note, Fast-lane badge.
- `SyntheticDataLabel` — the mandatory "Synthetic data — demo" + connector-status chip wrapper, wraps every Operate panel and nothing else (a single component makes the "no exceptions" rule in plan §7 easy to enforce by construction).
- `ReasonDialog` — generic mandatory-reason confirmation dialog, parameterized for threshold edit / pause-resume / return-review — one component, three call sites, keeps the "reason required" pattern consistent (plan §2 step 8, §9 P3).
- `EvidenceLink` — a row/cell renderer that deep-links from Audit results or Decisions into the target initiative's specific tab/event — used in Audit results table and Home SLA callouts.
- `RoleGate` — wraps admin-only / reviewer-only action buttons; two modes as noted in §8.4 (`hideEntirely` for role-based separation of duties vs. `disableWithTooltip` for auth-state gating) — should be two distinct exported behaviors of the same component or two small siblings, not one ambiguous prop.
- `OutcomeMetricCard` — the 5 Home strip cards, reusable shape (label, value, trend sparkline, tooltip).

---

## 10. Route → data-dependency table

| Route | Initiative | IntakeVersion | RiskAssessment | ReviewCycle | ReviewDecision | DeploymentVersion | ControlDefinition | EffectiveControl | Observation | Incident | AuditEvent | RunBudget |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | ✓ | | ✓ | | | ✓ | | ✓ (rollup) | ✓ (rollup) | ✓ (rollup) | ✓ (recent) | |
| `/initiatives/[slug]` (Overview) | ✓ | | ✓ | ✓ (summary) | ✓ (summary) | ✓ | | ✓ (summary) | | | | |
| `/initiatives/[slug]` (Intake) | ✓ | ✓ | | | | | | | | | | |
| `/initiatives/[slug]` (Reviews) | ✓ | | | ✓ | ✓ | | | | | | | |
| `/initiatives/[slug]` (Decisions) | ✓ | | | ✓ | ✓ | | | ✓ (via conditions) | | | | |
| `/initiatives/[slug]` (Controls) | ✓ | | ✓ (flags) | | | ✓ | ✓ | ✓ | | | | |
| `/initiatives/[slug]` (Operate) | ✓ | | | | | ✓ | ✓ (Q-01) | ✓ (Q-01) | ✓ | ✓ | | ✓ |
| `/initiatives/[slug]` (Audit) | ✓ | | | | | | | | | ✓ | ✓ | |
| `/initiatives/new` | (create) | ✓ (draft) | (preview via client rules) | | | | ✓ (preview) | | | | | |
| `/reviews` | ✓ (summary) | | | ✓ | ✓ | | | | | | | |
| `/audit` | ✓ (joined) | | | | ✓ | | | ✓ | | | ✓ | |
| `/admin` | | | | | | ✓ | ✓ (Q-01) | ✓ (Q-01) | ✓ (for monitor eval) | ✓ (created on breach) | ✓ | ✓ |

---

## 11. Cross-cutting notes for implementers

- **No route is role-scoped.** If you find yourself wanting to add `/admin` behind a role-based route guard beyond "show a banner and hide buttons," stop — re-read §0. The demo's entire UX argument is one app, contextual actions.
- **The "Synthetic data — demo" label is non-negotiable and must wrap every Operate panel with no exceptions** — this is a plan §7 / Codex F6 requirement, not a nice-to-have, and it's the difference between an honest demo and a misleading one.
- **Mandatory-reason dialogs** (threshold edit, pause/resume, review return) should share one `ReasonDialog` component — three near-identical dialogs invite copy-paste drift on the one thing (mandatory reason + audit write) that must never be skipped.
- **Admin's missing approve/sign buttons** are a correctness requirement, not a style choice — a reviewer agent or later contributor adding a convenience "quick approve" button to Admin's view would silently break the plan's central governance claim (agents/admin never hold approval authority). Recommend a lint rule or code comment flagging this file/component boundary explicitly.
- Recharts is sufficient for every chart described here (line, reference-line, bar, sparkline, simple heatmap-as-table). No additional charting library is needed for M1.
