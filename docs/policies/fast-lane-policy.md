# Meridian AI Policy — Pre-Approved Fast-Lane Policy, FL-2026-01 v1

**Effective date:** 2026-02-02
**Owner role:** Accountable Approver — Angela Torres, VP, AI Governance (standing authority;
see FL-3 for the mechanism). Administered day-to-day by the Program Office (Nia Okafor).
**Applies to:** Low-tier AI/ML initiatives meeting the deterministic eligibility criteria in
FL-2. Agents (eve) may recommend fast-lane routing but never issue the approval themselves —
approval authority is never delegated to an agent.

> Fictional internal policy for the Jeeves demo. Invented for Meridian Health; no real
> organization, regulation, or approval authority is referenced.

## FL-1. Purpose

**FL-1.1** This policy establishes a deterministic, pre-approved path for AI/ML initiatives
whose risk profile is low enough that a full eight-domain governance review would be
disproportionate to the risk presented, while preserving a named, accountable approver and a
full audit trail for every fast-lane approval.

**FL-1.2** Fast-lane approval is **not** agent auto-approval. An agent may compute eligibility
and draft the routing recommendation, but the approval itself is issued under the standing
authority Angela Torres holds by virtue of this policy (see FL-3), and every use is individually
recorded against her name — never against the agent or a generic "system" actor.

## FL-2. Deterministic Eligibility Criteria

**FL-2.1** An initiative is fast-lane eligible if and only if **all** of the following hold at
the time of routing:

1. **Tier = Low**, as derived by `lib/triage/rules.ts` from the intake overlay flags — tier is
   never manually overridden to force eligibility.
2. **Intake is complete** — every required intake field, including the data-retention answer,
   has a non-blank response. An incomplete intake is never fast-lane eligible regardless of how
   low-risk it otherwise appears.
3. **No PHI** — the intake overlay flag `PHI = N`.
4. **Not member-facing** — the intake overlay flag `member-facing = N`.
5. **No care/coverage influence** — the intake overlay flag `care-coverage = N`.

**FL-2.2** Vendor-hosted initiatives (`vendor = Y`) may still be fast-lane eligible provided
FL-2.1(1)-(5) all hold; vendor status alone does not disqualify an initiative from the fast lane,
but the vendor-applicable catalog controls (L-01, P-01, P-02) still attach to the deployment as
effective controls and must be satisfied on their own cadence — the fast lane shortens the
*approval path*, not the ongoing *control obligations*.

**FL-2.3** Eligibility is computed strictly from the five criteria in FL-2.1. There is no
discretionary override that grants fast-lane eligibility to an initiative failing any one
criterion; an initiative failing any criterion must route through the standard multi-domain
review process instead.

**FL-2.4** Eligibility must be re-computed if any overlay flag or the tier changes after initial
routing but before the fast-lane approval is recorded; a change that would fail FL-2.1 removes
the initiative from the fast lane immediately.

## FL-3. Named Accountable Approver Mechanism

**FL-3.1** Fast-lane approvals are issued under Angela Torres's standing approval authority as
VP, AI Governance. This standing authority is granted by this policy document itself (FL-2026-01)
and does not require a fresh, individual sign-off action from Angela Torres for each fast-lane
initiative — that is the operational efficiency the fast lane exists to provide.

**FL-3.2** Notwithstanding FL-3.1, every fast-lane approval must be **recorded per-use** as a
distinct decision record naming: the initiative, the eligibility criteria evaluated and their
values at time of routing, the policy version (FL-2026-01 v1) under which the approval was
issued, and Angela Torres as the accountable approver of record.

**FL-3.3** A fast-lane approval record is functionally equivalent to a standard `ReviewDecision`
approval for audit purposes — it appears in "everything approved by Angela Torres" queries
(seed-spec §7 query 2) exactly as an individually-signed approval would, because accountability
attaches to her standing authority regardless of the streamlined path.

**FL-3.4** Angela Torres may revoke or narrow her standing authority under this policy at any
time (see FL-5); she may not delegate the authority itself to another individual or to an agent
without issuing a superseding policy version.

## FL-4. Audit Requirements

**FL-4.1** Every fast-lane approval must generate an audit trail equivalent in kind to a
standard review cycle: an intake-submitted event, a triage-classified event (with the rule
inputs that produced Tier = Low), a fast-lane-eligibility-computed event (with the FL-2.1
criteria values), and a decision event recording the approval under Angela Torres's name and
this policy's version.

**FL-4.2** No fast-lane approval may be recorded without a triage-classified event immediately
preceding it in the audit trail; an approval with no traceable tier derivation is an orphan state
and is not permitted (consistent with the no-orphan-states requirement in seed-spec §5).

**FL-4.3** The Program Office (Nia Okafor) must be able to produce, on request, a complete list
of all fast-lane approvals issued in any period, each linked to its eligibility snapshot and
decision event.

**FL-4.4** Fast-lane approvals remain subject to whatever monitor-cadence controls attach to the
initiative post-deployment (e.g., L-02 marketing-claims review, S-02 secrets & access review);
the fast lane accelerates the approval gate only, not ongoing monitor obligations.

## FL-5. Revocation Triggers

**FL-5.1** An individual fast-lane approval must be revoked and the initiative routed to standard
multi-domain review if, after approval: (a) any overlay flag changes such that FL-2.1 would no
longer be satisfied (e.g., the initiative gains member-facing scope); (b) the intake is found to
have been materially incomplete or inaccurate at the time of routing; (c) an incident or
adverse finding suggests the initiative's actual risk exceeds Low tier.

**FL-5.2** The standing authority granted by this policy (FL-3.1) may itself be revoked or
suspended by: (a) Angela Torres, at her discretion; (b) a successor VP, AI Governance, upon
transition of role; (c) issuance of a superseding fast-lane policy version. Revocation of the
standing authority does not retroactively invalidate approvals already recorded under FL-3.2 —
it only prevents new fast-lane approvals from being issued under the revoked authority.

**FL-5.3** Any revocation event under FL-5.1 or FL-5.2 must be recorded as an auditable event
with a stated reason, consistent with the global rule that no irreversible or state-changing
governance action occurs without a recorded reason.

## FL-6. Relationship to Standard Review

**FL-6.1** The fast lane is a routing shortcut for the *approval decision* only. It does not
exempt an initiative from any applicable control in the catalog (e.g., a vendor-hosted, Low-tier
initiative still owes L-01 and P-01/P-02 on their normal enforcement mode and cadence).

**FL-6.2** An initiative that is fast-lane approved and later has its tier increased through a
material change must be treated as a new initiative for governance purposes from the point of
change forward: it loses fast-lane status (FL-5.1(a)) and enters standard review for the
domains newly implicated by the change.
