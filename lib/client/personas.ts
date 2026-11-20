/** Client-safe picker projection; authorization remains server-side. */
import { DEMO_PERSONAS, REVIEWER_DOMAIN as DEMO_REVIEWER_DOMAIN, reviewerDomainForPersona } from "../demo/personas";
import type { ActorRole, Domain } from "@/lib/domain/types";
import type { RoleKey } from "@/components/jeeves/role-context";

export interface LivePersona {
  personaKey: string;
  label: string;
  role: Extract<ActorRole, "requester" | "reviewer" | "approver" | "admin" | "program">;
}

// Build-time switch. next.config.ts inlines JEEVES_DEMO_ENABLED, so in a
// demo-disabled build (the production image) every `DEMO_BUILD ? demo : neutral`
// below folds to the neutral side and the bundler drops lib/demo/personas.ts
// and the names in it from the public JavaScript. Each demo value is chosen in
// this one module, and only the chosen value is imported elsewhere, so no
// other module has to repeat the test. scripts/check-demo-free-bundle.cjs
// proves the result on a real build.
const DEMO_BUILD = process.env.JEEVES_DEMO_ENABLED !== "0";

/** One anonymous entry per role: what the console's role-based rendering falls back to when there is no demo roster. */
const ROLE_ONLY_PERSONAS: LivePersona[] = [
  { personaKey: "requester", label: "Requester", role: "requester" },
  { personaKey: "reviewer", label: "Reviewer", role: "reviewer" },
  { personaKey: "program", label: "Program Office", role: "program" },
  { personaKey: "approver", label: "Approver", role: "approver" },
  { personaKey: "admin", label: "Admin", role: "admin" },
];

/** Public picker projection from the same facts used by server role resolution. */
export const LIVE_PERSONAS: LivePersona[] = DEMO_BUILD
  ? DEMO_PERSONAS.map((persona) => ({
      personaKey: persona.id,
      label: persona.name,
      role: persona.role,
    }))
  : ROLE_ONLY_PERSONAS;

/** The persona the console starts as (the neutral ops overview). */
export const DEFAULT_PERSONA_KEY: string = DEMO_BUILD ? "nia-okafor" : "program";

/** Who "Start demo" and "Try the demo" sign in as; empty where there is no demo. */
export const DEMO_ENTRY_PERSONA_KEY: string = DEMO_BUILD ? "priya-raman" : "";

/** The persona `setRoleKey()` lands on for each role key. */
export const REPRESENTATIVE_PERSONA_KEY: Record<RoleKey, string> = DEMO_BUILD
  ? { requester: "priya-raman", reviewer: "elena-vasquez", program: "nia-okafor", audit: "angela-torres", admin: "ray-chen" }
  : { requester: "requester", reviewer: "reviewer", program: "program", audit: "approver", admin: "admin" };

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

export const REVIEWER_DOMAIN: Readonly<Record<string, Domain>> = DEMO_BUILD ? DEMO_REVIEWER_DOMAIN : {};

/** Looks up the governance domain owned by a reviewer persona, if any. */
export function domainForPersona(personaKey: string): Domain | null {
  return DEMO_BUILD ? reviewerDomainForPersona(personaKey) : null;
}
