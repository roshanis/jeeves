/**
 * DeploymentHistory — read-only per-initiative deployment-version timeline
 * (M3 promotion-view extension, deliverable 1). Renders the ordered
 * `DeploymentHistoryEntry[]` from `GET`-side data (either
 * `promotion-service.ts#deploymentHistory` fetched server-side, or a
 * per-item slice already attached to a `PromotionListItem`-shaped row on the
 * /promotions page). Public/read-only — no session or role gating; nothing
 * here mutates.
 *
 * Newest-first ordering is the CALLER's responsibility (matches
 * `deploymentHistory`'s own contract) — this component renders whatever
 * order it is given.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DeploymentHistoryEntryLike {
  id: string;
  version: string;
  status: "deployed" | "paused" | "awaiting_promotion_signoff" | "retired";
  modelVersion: string | null;
  deployedAt: string;
  pausedAt: string | null;
  retiredAt: string | null;
  isCurrent: boolean;
}

// Token-based status pill (data-color contract §status-*) — deployment
// status is not a LifecycleState (awaiting_promotion_signoff has no
// lifecycle-state equivalent), so this rides the same reserved status
// family lifecycle-badge/tier-badge use rather than importing a
// type-incompatible component.
const STATUS_TONE: Record<
  DeploymentHistoryEntryLike["status"],
  { bg: string; fg: string; label: string }
> = {
  deployed: { bg: "bg-status-good-bg", fg: "text-status-good-fg", label: "Deployed" },
  paused: { bg: "bg-status-warning-bg", fg: "text-status-warning-fg", label: "Paused" },
  awaiting_promotion_signoff: {
    bg: "bg-status-warning-bg",
    fg: "text-status-warning-fg",
    label: "Awaiting sign-off",
  },
  retired: { bg: "bg-status-neutral-bg", fg: "text-status-neutral-fg", label: "Retired" },
};

function StatusPill({ status }: { status: DeploymentHistoryEntryLike["status"] }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      data-slot="deployment-history-status"
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        tone.bg,
        tone.fg,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {tone.label}
    </span>
  );
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function DeploymentHistory({
  title,
  entries,
}: {
  /** Card heading, e.g. the initiative title. */
  title: string;
  entries: DeploymentHistoryEntryLike[];
}) {
  return (
    <Card data-slot="deployment-history" className="overflow-hidden">
      <CardHeader className="border-b bg-muted/40 py-2.5">
        <CardTitle className="kicker">
          Deployment-version history — {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deployment versions recorded for this initiative.
          </p>
        ) : (
          <ol className="flex flex-col gap-3" data-slot="deployment-history-timeline">
            {entries.map((entry) => (
              <li
                key={entry.id}
                data-slot="deployment-history-entry"
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 pl-3",
                  entry.isCurrent ? "border-primary" : "border-muted",
                )}
              >
                <span className="font-mono text-sm font-medium tabular-nums">{entry.version}</span>
                <StatusPill status={entry.status} />
                {entry.isCurrent ? (
                  <Badge variant="outline" data-slot="deployment-history-current-badge">
                    Current
                  </Badge>
                ) : null}
                {entry.modelVersion ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {entry.modelVersion}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  deployed {shortDate(entry.deployedAt)}
                  {entry.pausedAt ? ` · paused ${shortDate(entry.pausedAt)}` : ""}
                  {entry.retiredAt ? ` · retired ${shortDate(entry.retiredAt)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
