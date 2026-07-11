/**
 * Client-side mirror of the demo persona directory.
 *
 * The authoritative list lives in `lib/services/actors.ts`
 * (`ACTOR_DIRECTORY`) — that module is server-side and off-limits for
 * client imports (ownership boundary: UI code never imports from
 * `lib/services/*`), so the 9 personas are mirrored here verbatim. If the
 * server directory changes, this list must be updated in the same change.
 */
import type { ActorRole, Domain } from "@/lib/domain/types";
import type { RoleKey } from "@/components/jeeves/role-context";

export interface LivePersona {
  personaKey: string;
  label: string;
  role: Extract<ActorRole, "requester" | "reviewer" | "approver" | "admin" | "program">;
}

/** Mirrors lib/services/actors.ts ACTOR_DIRECTORY (seed-spec §1). */
export const LIVE_PERSONAS: LivePersona[] = [
  { personaKey: "priya-raman", label: "Priya Raman", role: "requester" },
  { personaKey: "dan-kowalski", label: "Dan Kowalski", role: "requester" },
  { personaKey: "elena-vasquez", label: "Dr. Elena Vasquez", role: "reviewer" },
  { personaKey: "marcus-webb", label: "Marcus Webb", role: "reviewer" },
  { personaKey: "sofia-grant", label: "Sofia Grant", role: "reviewer" },
  { personaKey: "james-liu", label: "James Liu", role: "reviewer" },
  { personaKey: "angela-torres", label: "Angela Torres", role: "approver" },
  { personaKey: "ray-chen", label: "Ray Chen", role: "admin" },
  { personaKey: "nia-okafor", label: "Nia Okafor", role: "program" },
];

export function findPersona(personaKey: string): LivePersona | undefined {
  return LIVE_PERSONAS.find((p) => p.personaKey === personaKey);
}

/** Human-readable role group labels for the persona picker. */
export const PERSONA_ROLE_LABEL: Record<LivePersona["role"], string> = {
  requester: "Requester",
  reviewer: "Reviewer",
  approver: "Approver",
  admin: "Admin",
  program: "Program Office",
};

/**
 * Maps a live session's ActorRole onto the existing 5-value client
 * `RoleKey` used by `useRole()`/RoleGate, so logging in as a persona also
 * flips the app's role-based rendering to match:
 *   requester -> requester, reviewer -> reviewer, program -> program,
 *   approver -> audit (the "Audit / Leadership" role key is the one whose
 *   persona is Angela Torres, the approver), admin -> admin.
 */
export function roleKeyForActorRole(role: LivePersona["role"]): RoleKey {
  switch (role) {
    case "requester":
      return "requester";
    case "reviewer":
      return "reviewer";
    case "program":
      return "program";
    case "approver":
      return "audit";
    case "admin":
      return "admin";
  }
}

/**
 * The 4 named reviewer personas each own exactly one governance domain
 * (seed-spec §1). This is what makes the "Reviewer" role specific: Sofia
 * Grant (Responsible AI) owns eval-quality & fairness signals, not James Liu
 * (Legal) or the other domain reviewers.
 */
export const REVIEWER_DOMAIN: Record<string, Domain> = {
  "elena-vasquez": "clinical-safety",
  "marcus-webb": "privacy-hipaa",
  "sofia-grant": "responsible-ai",
  "james-liu": "legal",
};

/** Looks up the governance domain owned by a reviewer persona, if any. */
export function domainForPersona(personaKey: string): Domain | null {
  return REVIEWER_DOMAIN[personaKey] ?? null;
}
