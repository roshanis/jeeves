"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useRole } from "./role-context";
import {
  LIVE_PERSONAS,
  PERSONA_ROLE_LABEL,
  REVIEWER_DOMAIN,
  type LivePersona,
} from "@/lib/client/personas";
import { DOMAIN_LABEL } from "./domain-labels";
import { useLiveSessionOptional } from "@/lib/client/session-context";

// Group order: Requester, Reviewer, Approver, Program Office, Admin.
const PERSONA_GROUP_ORDER: LivePersona["role"][] = [
  "requester",
  "reviewer",
  "approver",
  "program",
  "admin",
];

function personaOptionLabel(persona: LivePersona): string {
  const domain = REVIEWER_DOMAIN[persona.personaKey];
  return domain ? `${persona.label} · ${DOMAIN_LABEL[domain]}` : persona.label;
}

/**
 * Instant, client-side persona switcher (ui-spec §8.2). Switching persona
 * only changes which actions/saved-views render — it never re-fetches a
 * different data set. Selecting a specific person also selects their role
 * and (for reviewers) their governance domain.
 */
export function RoleSwitcher() {
  const { personaKey, setPersonaKey, persona, reviewerDomain } = useRole();
  const session = useLiveSessionOptional()?.session ?? null;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={personaKey}
        disabled={Boolean(session)}
        onValueChange={(value) => {
          if (value) setPersonaKey(value);
        }}
      >
        <SelectTrigger
          aria-label={session ? "Authenticated persona" : "Public preview persona"}
          size="sm"
        >
          <SelectValue>{() => persona.actorName}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERSONA_GROUP_ORDER.map((role) => (
            <SelectGroup key={role}>
              <SelectLabel>{PERSONA_ROLE_LABEL[role]}</SelectLabel>
              {LIVE_PERSONAS.filter((p) => p.role === role).map((p) => (
                <SelectItem key={p.personaKey} value={p.personaKey}>
                  {personaOptionLabel(p)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {reviewerDomain ? (
        <Badge
          variant="secondary"
          className="hidden xl:inline-flex"
          data-slot="active-domain-chip"
        >
          {DOMAIN_LABEL[reviewerDomain]}
        </Badge>
      ) : (
        <Badge variant="outline" className="hidden sm:inline-flex">
          {persona.label}
        </Badge>
      )}
      {session ? (
        <span className="sr-only">Preview switching is unavailable during a live session.</span>
      ) : (
        <span className="text-xs font-medium text-muted-foreground" title="Actions remain read-only">
          Preview
          <span className="sr-only"> persona; actions remain read-only.</span>
        </span>
      )}
    </div>
  );
}
