// Deployments tab (split from the former Operate tab — ui-spec §3.6):
// version/status history for this initiative's deployed model artifacts.
// Telemetry/eval charts live on the separate Evals tab; this tab is a
// restrained release ledger only.
import type { DeploymentRow } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const DEPLOYMENT_STATUS_LABEL: Record<DeploymentRow["status"], string> = {
  deployed: "Deployed",
  paused: "Paused",
  awaiting_promotion_signoff: "Awaiting promotion sign-off",
  retired: "Retired",
};

// Token-based status pill (data-color contract §status-*) — mirrors
// deployment-history.tsx's tone mapping; DeploymentRow["status"] is not a
// LifecycleState, so this rides the reserved status family directly rather
// than importing a type-incompatible badge component.
const STATUS_TONE: Record<DeploymentRow["status"], { bg: string; fg: string }> = {
  deployed: { bg: "bg-status-good-bg", fg: "text-status-good-fg" },
  paused: { bg: "bg-status-warning-bg", fg: "text-status-warning-fg" },
  awaiting_promotion_signoff: { bg: "bg-status-warning-bg", fg: "text-status-warning-fg" },
  retired: { bg: "bg-status-neutral-bg", fg: "text-status-neutral-fg" },
};

function StatusPill({ status }: { status: DeploymentRow["status"] }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        tone.bg,
        tone.fg,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {DEPLOYMENT_STATUS_LABEL[status]}
    </span>
  );
}

function shortDate(ts: string): string {
  return ts.slice(0, 10);
}

export function DeploymentsTab({ deployments }: { deployments: DeploymentRow[] }) {
  const awaitingSignoff = deployments.some(
    (d) => d.status === "awaiting_promotion_signoff",
  );

  return (
    <div data-slot="deployments-tab">
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 py-2.5">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Deployment history
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deployments recorded — this initiative has no active release.
            </p>
          ) : (
            <>
              <Table containerLabel="Deployment versions, scrollable horizontally">
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deployments.map((d) => (
                    <TableRow key={d.version}>
                      <TableCell className="font-mono">{d.version}</TableCell>
                      <TableCell>
                        <StatusPill status={d.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {shortDate(d.at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {awaitingSignoff ? (
                <p className="mt-3 text-xs text-status-warning-fg">
                  One or more versions await promotion sign-off — see the Evals
                  tab for the offline eval comparison.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
