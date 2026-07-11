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
import { Badge } from "@/components/ui/badge";

export const DEPLOYMENT_STATUS_LABEL: Record<DeploymentRow["status"], string> = {
  deployed: "Deployed",
  paused: "Paused",
  awaiting_promotion_signoff: "Awaiting promotion sign-off",
  retired: "Retired",
};

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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deployments.map((d) => (
                    <TableRow key={d.version}>
                      <TableCell className="font-mono">{d.version}</TableCell>
                      <TableCell>
                        <Badge variant={d.status === "deployed" ? "default" : "secondary"}>
                          {DEPLOYMENT_STATUS_LABEL[d.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{shortDate(d.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {awaitingSignoff ? (
                <p className="mt-3 text-xs text-amber-600">
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
