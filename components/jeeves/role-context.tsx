"use client";

// Client-side role switcher context (ui-spec §0, §8.2). Switching role is
// instant and client-side — it never re-fetches a different data set, only
// changes which actions/saved-views render. No route is role-scoped.
import * as React from "react";
import type { ActorRole } from "@/lib/domain/types";

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

interface RoleContextValue {
  roleKey: RoleKey;
  setRoleKey: (key: RoleKey) => void;
  persona: RolePersona;
}

const RoleContext = React.createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [roleKey, setRoleKey] = React.useState<RoleKey>("requester");
  const persona = ROLE_PERSONAS[roleKey];

  const value = React.useMemo(
    () => ({ roleKey, setRoleKey, persona }),
    [roleKey, persona],
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
