/** Client-safe picker projection; authorization remains server-side. */
import { DEMO_PERSONAS, reviewerDomainForPersona } from "../demo/personas";
import type { ActorRole, Domain } from "@/lib/domain/types";
import type { RoleKey } from "@/components/jeeves/role-context";

export interface LivePersona {
  personaKey: string;
  label: string;
  role: Extract<ActorRole, "requester" | "reviewer" | "approver" | "admin" | "program">;
}

/** Public picker projection from the same facts used by server role resolution. */
export const LIVE_PERSONAS: LivePersona[] = DEMO_PERSONAS.map((persona) => ({
  personaKey: persona.id,
  label: persona.name,
  role: persona.role,
}));

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

export { REVIEWER_DOMAIN } from "../demo/personas";

/** Looks up the governance domain owned by a reviewer persona, if any. */
export function domainForPersona(personaKey: string): Domain | null {
  return reviewerDomainForPersona(personaKey);
}
