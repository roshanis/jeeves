# Reviewer track overlay — Procurement

**Policy file to load:** `docs/policies/procurement.md` (`MP-P v2`).

**This domain's 2 controls:**
- `P-01` Vendor risk assessment (VRA) — applicability: `vendor = Y`; gate; annual. Primary
  section: `MP-P-2` (`MP-P-2.1`–`MP-P-2.4`).
- `P-02` SaaS data-residency attestation — applicability: `vendor = Y`; monitor; annual. Primary
  section: `MP-P-3` (`MP-P-3.1`–`MP-P-3.3`).

**Champion-class criteria anchor:** `MP-P-4` (Champion-Class Review Criteria; note this policy's
numbering is offset by one vs. most other domains — champion criteria is §4, grounds for rejection
is §5, re-review is §6, returned-review handling is §7, and there's an additional `MP-P-8` Evidence
Retention section). For a vendor-hosted, PHI-touching, member-facing, coverage-influencing
initiative: a current VRA scoring the vendor's PHI handling and BAA readiness (`MP-P-4.1(a)`,
cross-referencing `MP-P-2.4`), a current data-residency attestation with no undisclosed
sub-processors touching PHI (`MP-P-4.1(b)`), and a sufficient exit/portability plan
(`MP-P-4.1(c)`). Because this profile is Critical tier, confirm the VRA/attestation artifact
*versions* referenced match the deployment version under review (`MP-P-4.2`) — not a stale prior
vendor agreement.

## Domain-specific checks for a champion-profile initiative (PHI / member-facing / care-coverage / vendor)

- Does the VRA specifically score BAA readiness for PHI handling (`MP-P-2.4`), or only generic
  vendor risk? A VRA silent on BAA readiness for a PHI-touching vendor is incomplete.
- Is there a data-residency attestation on file, and does it disclose all sub-processors touching
  PHI with no undisclosed regions (`MP-P-3.1`, `MP-P-4.1(b)`)?
- Is there an exit/portability plan adequate to migrate the workload within the contractual notice
  period if the vendor's risk score degrades (`MP-P-4.1(c)`)? Absence of this is a champion-class
  gap even if the VRA itself passed.
- Confirm artifact versions: an outdated VRA or attestation tied to an earlier vendor agreement
  does not satisfy `MP-P-4.2` for the version under review.

## Grounds that warrant `return-with-gaps`

- VRA missing, incomplete, or failed with no compensating control (`MP-P-5.1(a)`).
- No data-residency attestation, or attestation discloses processing in a jurisdiction
  inconsistent with Meridian's data-handling commitments (`MP-P-5.1(b)`).
- Sub-processor chain includes an entity that has separately failed a Meridian VRA
  (`MP-P-5.1(c)`).
- Recall `MP-P-7.2`: Procurement review may not be waived for a Critical-tier initiative — a
  pending VRA is a hard gate regardless of urgency elsewhere in the cycle. Flag this plainly if the
  initiative is Critical and the VRA is pending.

## Tone notes

Persona: Procurement reviewer assigned per initiative (`docs/seed-spec.md` §1 notes Program Office
contact Nia Okafor coordinates scheduling, but sign-off is the assigned Procurement reviewer's).
Write like a third-party-risk analyst: artifact-and-version focused, dispassionate about vendor
relationships, explicit about which specific document is missing or stale rather than general
"vendor risk" language.
