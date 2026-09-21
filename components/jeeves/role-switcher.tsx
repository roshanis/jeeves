"use client";

import { Badge } from "@/components/ui/badge";
import { useRole } from "./role-context";
import { LIVE_PERSONAS, PERSONA_ROLE_LABEL, REVIEWER_DOMAIN, type LivePersona } from "@/lib/client/personas";
import { DOMAIN_LABEL } from "./domain-labels";
import { useLiveSessionOptional } from "@/lib/client/session-context";

const PERSONA_GROUP_ORDER: LivePersona["role"][] = ["requester", "reviewer", "approver", "program", "admin"];

export function RoleSwitcher() {
  const { personaKey, setPersonaKey, persona, reviewerDomain } = useRole();
  const live = useLiveSessionOptional();
  return (
    <div className="flex min-w-0 items-center gap-2" aria-busy={live?.pending ?? false}>
      <select
        aria-label="Demo persona"
        data-slot="demo-persona-select"
        value={personaKey}
        disabled={live?.pending ?? false}
        className="h-9 min-w-0 max-w-40 rounded-md border border-input bg-background px-2 text-sm sm:max-w-56"
        onChange={(event) => {
          if (live) void live.login(event.target.value).catch(() => { /* Error shown beside the demo controls. */ });
          else setPersonaKey(event.target.value);
        }}
      >
        {PERSONA_GROUP_ORDER.map((role) => (
          <optgroup key={role} label={PERSONA_ROLE_LABEL[role]}>
            {LIVE_PERSONAS.filter((p) => p.role === role).map((p) => (
              <option key={p.personaKey} value={p.personaKey}>
                {p.label}{REVIEWER_DOMAIN[p.personaKey] ? ` · ${DOMAIN_LABEL[REVIEWER_DOMAIN[p.personaKey]!]}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {live?.pending ? <span role="status" className="sr-only">Changing demo persona…</span> : null}
      <Badge variant="outline" className="hidden xl:inline-flex" data-slot={reviewerDomain ? "active-domain-chip" : undefined}>
        {reviewerDomain ? DOMAIN_LABEL[reviewerDomain] : persona.label}
      </Badge>
    </div>
  );
}
