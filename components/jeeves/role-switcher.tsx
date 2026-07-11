"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ROLE_ORDER, ROLE_PERSONAS, useRole, type RoleKey } from "./role-context";

/**
 * Instant, client-side role switcher (ui-spec §8.2). Switching role only
 * changes which actions/saved-views render — it never re-fetches a
 * different data set.
 */
export function RoleSwitcher() {
  const { roleKey, setRoleKey, persona } = useRole();

  return (
    <div className="flex items-center gap-2">
      <Select value={roleKey} onValueChange={(value) => setRoleKey(value as RoleKey)}>
        <SelectTrigger aria-label="Switch role" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLE_ORDER.map((key) => (
            <SelectItem key={key} value={key}>
              {ROLE_PERSONAS[key].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Badge variant="outline" className="hidden sm:inline-flex">
        {persona.actorName}
      </Badge>
    </div>
  );
}
