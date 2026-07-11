"use client";

// Client-side role switcher context (ui-spec §0, §8.2). Switching role is
// instant and client-side — it never re-fetches a different data set, only
// changes which actions/saved-views render. No route is role-scoped.
//
// The SOURCE OF TRUTH is now the selected persona (personaKey), not the
// role: personaKey drives roleKey/persona/reviewerDomain by lookup against
// LIVE_PERSONAS (lib/client/personas.ts). This is what makes "Reviewer" mean
// a SPECIFIC person scoped to a SPECIFIC governance domain (e.g. Sofia Grant
// -> responsible-ai) rather than one generic role. `roleKey`/`setRoleKey`/
// `persona` keep their original shape for back-compat with role-gate.tsx,
// role-switcher's RoleKey-based consumers, and existing tests.
import * as React from "react";
import type { ActorRole, Domain } from "@/lib/domain/types";
import {
  LIVE_PERSONAS,
  REVIEWER_DOMAIN,
  domainForPersona,
  roleKeyForActorRole,
  type LivePersona,
} from "@/lib/client/personas";
import { DOMAIN_LABEL } from "@/components/jeeves/domain-labels";

export interface RolePersona {
  role: ActorRole;
  label: string;
  actorName: string;
}

// One representative persona per role (seed-spec §1). Reviewer defaults to
// Dr. Elena Vasquez (Clinical Safety) as a representative reviewer identity;
// the Reviews screens are not filtered to a single reviewer's assignments
// only, since this is a demo of the workflow, not a real per-user inbox.
export const ROLE_PERSONAS: Record<ActorRole | "audit", RolePersona> = {
  requester: { role: "requester", label: "Requester", actorName: "Priya Raman" },
  reviewer: { role: "reviewer", label: "Reviewer", actorName: "Dr. Elena Vasquez" },
  program: { role: "program", label: "Program Office", actorName: "Nia Okafor" },
  audit: { role: "approver", label: "Audit / Leadership", actorName: "Angela Torres" },
  admin: { role: "admin", label: "Admin", actorName: "Ray Chen" },
  approver: { role: "approver", label: "Audit / Leadership", actorName: "Angela Torres" },
  system: { role: "system", label: "System", actorName: "system" },
};

export type RoleKey = "requester" | "reviewer" | "program" | "audit" | "admin";

export const ROLE_ORDER: RoleKey[] = ["requester", "reviewer", "program", "audit", "admin"];

/**
 * Representative persona key per RoleKey — used by the back-compat
 * `setRoleKey()` so existing callers (tests, role-gate) that only know
 * about the 5-value RoleKey still land on a sensible specific persona.
 */
const REPRESENTATIVE_PERSONA: Record<RoleKey, string> = {
  requester: "priya-raman",
  reviewer: "elena-vasquez",
  program: "nia-okafor",
  audit: "angela-torres",
  admin: "ray-chen",
};

function findLivePersona(personaKey: string): LivePersona {
  const found = LIVE_PERSONAS.find((p) => p.personaKey === personaKey);
  if (found) return found;
  // Defensive fallback — should be unreachable given the closed personaKey
  // universe, but keeps this a total function.
  return LIVE_PERSONAS.find((p) => p.personaKey === "nia-okafor")!;
}

function personaToRolePersona(live: LivePersona): RolePersona {
  const domain = domainForPersona(live.personaKey);
  if (live.role === "reviewer" && domain) {
    return { role: live.role, label: `Reviewer · ${DOMAIN_LABEL[domain]}`, actorName: live.label };
  }
  // Non-reviewer roles: reuse the original ROLE_PERSONAS label (keyed by
  // RoleKey, not ActorRole) so e.g. the approver persona (Angela Torres)
  // keeps the exact "Audit / Leadership" label the app has always shown —
  // PERSONA_ROLE_LABEL["approver"] is "Approver", a different (also valid)
  // label used only by the demo-mode-chip's persona picker.
  const roleKey = roleKeyForActorRole(live.role);
  return { role: live.role, label: ROLE_PERSONAS[roleKey].label, actorName: live.label };
}

interface RoleContextValue {
  roleKey: RoleKey;
  setRoleKey: (key: RoleKey) => void;
  persona: RolePersona;
  personaKey: string;
  setPersonaKey: (key: string) => void;
  reviewerDomain: Domain | null;
}

const RoleContext = React.createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // Default persona is Nia Okafor (Program Office): it's the neutral
  // ops-overview persona, so the public/no-login landing page (app/page.tsx's
  // "What needs attention" inbox) renders the same content it always has
  // (ui-spec §2 role-aware saved views; keeps the e2e golden-path assertion
  // intact).
  const [personaKey, setPersonaKey] = React.useState<string>("nia-okafor");

  const live = findLivePersona(personaKey);
  const roleKey = roleKeyForActorRole(live.role);
  const persona = personaToRolePersona(live);
  const reviewerDomain = domainForPersona(personaKey);

  const setRoleKey = React.useCallback((key: RoleKey) => {
    setPersonaKey(REPRESENTATIVE_PERSONA[key]);
  }, []);

  const value = React.useMemo(
    () => ({ roleKey, setRoleKey, persona, personaKey, setPersonaKey, reviewerDomain }),
    [roleKey, setRoleKey, persona, personaKey, reviewerDomain],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** Client hook exposing the active demo role + persona (ui-spec §0). */
export function useRole(): RoleContextValue {
  const ctx = React.useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole() must be used within a RoleProvider");
  }
  return ctx;
}

// Re-exported so existing importers of REVIEWER_DOMAIN via role-context keep
// working if referenced from here; primary home is lib/client/personas.ts.
export { REVIEWER_DOMAIN };
