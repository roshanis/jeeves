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

const STATUS_LABEL: Record<DeploymentHistoryEntryLike["status"], string> = {
  deployed: "Deployed",
  paused: "Paused",
  awaiting_promotion_signoff: "Awaiting sign-off",
  retired: "Retired",
};

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
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
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
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-muted pl-3"
              >
                <span className="font-mono text-sm font-medium">{entry.version}</span>
                <Badge variant={entry.isCurrent ? "default" : "secondary"}>
                  {STATUS_LABEL[entry.status]}
                </Badge>
                {entry.isCurrent ? (
                  <Badge variant="outline" data-slot="deployment-history-current-badge">
                    Current
                  </Badge>
                ) : null}
                {entry.modelVersion ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {entry.modelVersion}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
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
