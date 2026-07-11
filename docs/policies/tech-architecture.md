# Meridian AI Policy — Technology Architecture Domain, MP-T v2

**Effective date:** 2026-01-12
**Owner role:** Reviewer — Tech Architecture (Architecture Review Board, chaired on a
per-initiative basis; Ray Chen, Platform Admin, provides infrastructure input but per
separation-of-duties rules under MP-T-1.3 cannot sign or approve)
**Applies to:** All AI/ML initiatives, Medium tier and above.

> Fictional internal policy corpus for the Jeeves demo. Meridian Health is a fictional payer;
> all section numbers and artifact names are invented.

## MP-T-1. Purpose and Scope

**MP-T-1.1** This policy governs architectural soundness, resilience, and operational readiness
review for AI/ML initiatives: system design, integration points, failure modes, and
disaster-recovery posture.

**MP-T-1.2** Tech Architecture review is required for all initiatives at Medium tier or above;
Low-tier initiatives are exempt unless routed out of the fast-lane policy (see
`fast-lane-policy.md` FL-2026-01).

**MP-T-1.3** Platform Admin personnel may provide technical input to an Architecture Review
Board (ARB) session but may not cast the reviewing signature; this preserves separation of
duties between platform operations and governance sign-off.

## MP-T-2. Architecture Review Record (control T-01)

**MP-T-2.1** Before first production deployment, the requester must present the initiative's
architecture to the ARB, covering: data flow (including any PHI or claims-data paths), model
invocation pattern (synchronous/async, fan-out), integration with source-of-truth systems, and
rollback/pause mechanism.

**MP-T-2.2** The ARB must produce signed minutes recording: attendees, diagrams or descriptions
reviewed, open risks accepted or remediated, and the resulting go/no-go recommendation. This is
a gate control — no production traffic may reach the initiative before ARB minutes are signed.

**MP-T-2.3** The Architecture Review Record must be refreshed on any material change to the
system design after initial approval (see MP-T-6); it is not a one-time artifact for the life of
the deployment.

**MP-T-2.4** For initiatives with a pause/resume capability (required under MP-T-4.2 for
Critical tier), the ARB must confirm the pause mechanism has been exercised in a non-production
environment before go-live.

## MP-T-3. Disaster Recovery Plan (control T-02)

**MP-T-3.1** For High-tier and Critical-tier initiatives, the requester must maintain a
disaster-recovery (DR) plan covering: model/service failover, data-store recovery point and
recovery time objectives, and a fallback procedure if the vendor endpoint (where applicable) is
unavailable.

**MP-T-3.2** The DR plan must be exercised at least annually (monitor cadence) with a logged DR
test; the test log is the required evidence artifact.

**MP-T-3.3** Where the initiative is vendor-hosted, the DR plan must specifically address vendor
outage as a failure mode distinct from Meridian-internal infrastructure failure, and document
the maximum acceptable degraded-service window before escalation.

## MP-T-4. Champion-Class Review Criteria

**MP-T-4.1** For a Critical-tier, vendor-hosted, coverage-influencing initiative, the ARB must
confirm at minimum: (a) a documented data flow showing where PHI enters and exits the model
invocation path, (b) a synchronous or bounded-latency invocation pattern suitable for a
human-in-the-loop review step (coordinate with MP-C, Clinical Safety), (c) a working pause/resume
mechanism reachable by an Admin action without requiring a code deployment, (d) a DR plan
covering vendor outage.

**MP-T-4.2** All Critical-tier initiatives must expose an operator-controlled pause/resume
capability; this is an architectural precondition for the eval-quality control (Q-01) to be
enforceable, since breach response depends on a working pause path.

**MP-T-4.3** The ARB must confirm that authoritative state transitions (intake, triage, review,
decision, deployment, control status) are implemented in Meridian application code and the
system of record, not delegated to the agent runtime or any fallback workflow adapter — an
architecture that stores governance state only inside an agent framework fails MP-T-4 outright.

## MP-T-5. Grounds for Rejection

**MP-T-5.1** Tech Architecture must recommend rejection or a blocking finding where: (a) no
pause/resume mechanism exists for a High-tier-or-above initiative; (b) the data flow cannot be
fully traced (an opaque or undocumented integration path touching PHI or claims data);
(c) the DR plan is absent for a Critical-tier initiative with no compensating control; (d) the
architecture stores decision or approval state exclusively outside the system of record (see
MP-T-4.3).

**MP-T-5.2** A rejection under MP-T-5.1 must identify the specific missing artifact or design
gap and, where feasible, a remediation path the requester can pursue before re-submission.

## MP-T-6. Re-Review Triggers

**MP-T-6.1** Architecture review recurs: (a) once at initial approval (gate); (b) on any material
change to system design after approval (gate, per MP-T-2.3); (c) DR plan cadence for High/Critical
tier is annual (monitor, MP-T-3.2).

**MP-T-6.2** "Material change" includes: a change in model hosting (self-hosted to vendor-hosted
or vice versa), a change in data flow that introduces a new PHI touchpoint, or removal/alteration
of the pause/resume mechanism.

**MP-T-6.3** A tier increase driven by a change in overlay flags (e.g., an initiative gaining
care-coverage influence) requires a full MP-T-2 re-review, not merely an addendum to the prior
record.

## MP-T-7. Returned Review Handling

**MP-T-7.1** The ARB may return a review where the architecture is broadly sound but a specific
artifact is missing (e.g., DR test log not yet run); the returned review must specify the
missing artifact and a reasonable timeframe for completion.

**MP-T-7.2** A returned architecture review blocks progression of dependent domain reviews only
where those domains explicitly rely on architectural facts not yet confirmed (e.g., Security's
threat model under MP-S depends on a confirmed data flow); otherwise domains may proceed in
parallel.
