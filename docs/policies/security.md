# Meridian AI Policy — Security Domain, MP-S v3

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Security (Platform Security office; Ray Chen, Platform Admin,
provides operational evidence such as access matrices but cannot sign or approve reviews —
separation of duties)
**Applies to:** All AI/ML initiatives; pen test/threat model applies High tier and above.

> Fictional internal policy corpus for the Jeeves demo. All section numbers and thresholds are
> invented for Meridian Health; no real security-assessment standard is reproduced.

## MP-S-1. Purpose and Scope

**MP-S-1.1** This policy governs security review of AI/ML initiatives: threat modeling,
penetration testing, secrets management, and access control hygiene for systems that invoke or
serve models.

**MP-S-1.2** Pen test / threat model (MP-S-2) applies to initiatives tiered High or Critical.
Secrets & access review (MP-S-3) applies to all initiatives regardless of tier.

## MP-S-2. Pen Test / Threat Model (control S-01)

**MP-S-2.1** For High-tier and Critical-tier initiatives, the requester must produce a threat
model identifying: prompt-injection and data-exfiltration vectors, model-inversion or
membership-inference exposure where PHI is used in fine-tuning, and API/auth boundary risks for
any endpoint that invokes the model.

**MP-S-2.2** A penetration test covering the initiative's externally reachable surface (API
endpoints, chat interfaces, admin actions) must be performed at least annually and before initial
production deployment; the pen-test report is the required evidence artifact. This is a gate
control.

**MP-S-2.3** Findings rated High or Critical severity in the pen-test report must be remediated
or have an accepted-risk sign-off from the Security reviewer before deployment; Medium/Low
findings may be tracked to remediation without blocking deployment.

**MP-S-2.4** Where the initiative invokes a vendor-hosted model, the threat model must
specifically address the trust boundary at the vendor API call: what data crosses it, whether
it is logged by the vendor, and what happens to that data if the vendor is compromised.

## MP-S-3. Secrets & Access Review (control S-02)

**MP-S-3.1** All initiatives, regardless of tier, must maintain an access matrix documenting
which roles and service accounts can read intake data, invoke the model, view outputs, and
administer the deployment (including pause/resume and threshold-change actions).

**MP-S-3.2** This is a monitor control on a quarterly cadence: the access matrix must be
reviewed each quarter to confirm least-privilege access still holds and that no departed
personnel or decommissioned service retains access.

**MP-S-3.3** API keys, vendor credentials, and any secret material used to invoke a vendor model
must be stored in Meridian's approved secrets manager; secrets must never appear in intake
records, review text, audit events, or any document intended for the governance record. A
reviewer who observes a secret in any such artifact must redact it and escalate immediately
(consistent with the global safety rule against exposing secrets).

**MP-S-3.4** Admin actions with elevated capability (threshold changes, pause/resume) must be
restricted to the Platform Admin role and must never be reachable by the same principal that
holds review sign-off or approval authority for the same initiative (separation of duties).

## MP-S-4. Champion-Class Review Criteria

**MP-S-4.1** For a Critical-tier, vendor-hosted, PHI-touching initiative, the Security reviewer
must confirm at minimum: (a) a threat model addressing the vendor API trust boundary and any
PHI exposure across it (MP-S-2.4), (b) a passed or risk-accepted pen test with no unresolved
High/Critical findings, (c) an access matrix showing PHI-scoped data access limited to the
roles that require it for review or operation, (d) confirmation that the Admin pause/resume
path is access-controlled separately from approver/reviewer accounts.

**MP-S-4.2** The Security reviewer must additionally confirm that the eval-quality monitor
(control Q-01) and its pause action are themselves access-controlled and audit-logged, since
the champion storyline's breach-response path depends on that control being trustworthy.

## MP-S-5. Grounds for Rejection

**MP-S-5.1** Security must recommend rejection or a blocking finding where: (a) an unresolved
High/Critical pen-test finding exists with no remediation plan or accepted-risk sign-off;
(b) the access matrix shows PHI-scoped access broader than required for the initiative's
function and the requester cannot narrow it; (c) secrets or credentials are found embedded in
application code, prompts, or stored intake/review records.

**MP-S-5.2** A rejection under MP-S-5.1(c) requires immediate remediation (credential rotation)
independent of, and prior to, any governance decision — this is a safety action, not merely a
policy finding.

## MP-S-6. Re-Review Triggers

**MP-S-6.1** Re-review is required: (a) pen test/threat model annual cadence for High/Critical
tier (MP-S-2.2); (b) access matrix quarterly cadence for all tiers (MP-S-3.2); (c) any material
change to the initiative's externally reachable surface (new endpoint, new integration, new
admin capability); (d) any disclosed security incident involving the initiative or its vendor.

**MP-S-6.2** A tier increase to High or Critical for an initiative that previously had no pen
test obligation triggers an immediate MP-S-2 gate review before continued production operation.

## MP-S-7. Returned Review Handling

**MP-S-7.1** A Security reviewer may return a review where a pen test is scheduled but not yet
complete, or where an access matrix is stale by less than one cadence period and update is
already in progress; the returned review must name the specific artifact and expected
completion.

**MP-S-7.2** A returned Security review does not itself pause an already-deployed initiative;
pausing requires either a Q-01 breach (automatic) or an explicit Admin pause action with a
recorded reason.
