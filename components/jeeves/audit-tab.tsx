// Audit tab (ui-spec §3.7): chronological AuditEvent timeline for one
// initiative — actor, timestamp, event type, structured detail.
import type { AuditEventRow } from "@/lib/data/dto";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function AuditTab({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No audit events yet.</p>;
  }

  return (
    <ol className="space-y-0" data-slot="audit-tab">
      {events.map((event, i) => (
        <li
          key={`${event.ts}-${event.action}-${i}`}
          className="relative flex gap-3 border-l pb-4 pl-4 last:pb-0"
        >
          <Avatar size="sm" className="mt-0.5 shrink-0">
            <AvatarFallback>{initials(event.actor)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                {event.action}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {event.ts.slice(0, 10)} · {event.actor} ({event.actorRole})
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{event.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
