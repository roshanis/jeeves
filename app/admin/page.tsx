import { getAppProvider } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { RunMonitorPanel } from "@/components/jeeves/run-monitor-panel";
import { ThresholdEditAction } from "@/components/jeeves/threshold-edit-action";
import { DeploymentActionButton } from "@/components/jeeves/deployment-action-button";
import type { ThresholdInitiativeOption } from "@/components/jeeves/threshold-edit-dialog";

// The Admin console (ui-spec §7) is the narrowest screen by design: exactly
// two mutable action shapes (Q-01 threshold edit, pause/resume) plus "Run
// monitor". In a live admin session those actions call the gated API; without
// one every button renders disabled-with-tooltip. NO approve/sign/return-style
// button exists on this page for any role — separation of duties is
// architectural, not a permission flag.

// Incidents come from the DB (post-breach). In mock/read-only mode there is no
// DB to query, so we skip the fetch entirely and render the empty state.
async function loadIncidents(): Promise<IncidentListRow[]> {
  const dbMode =
    process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (!dbMode) return [];
  try {
    return await listIncidents(getDb());
  } catch {
    // A missing/unseeded store must not crash the console.
    return [];
  }
}

export default async function AdminPage() {
  const provider = getAppProvider();
  const [catalog, initiatives, q01Changes, incidents] = await Promise.all([
    provider.controlCatalog(),
    provider.listInitiatives(),
    provider.auditQuery("q01-control-changes"),
    loadIncidents(),
  ]);

  const q01 = catalog.find((c) => c.id === "Q-01");
  const details = await Promise.all(
    initiatives.map((i) => provider.getInitiativeDetail(i.slug)),
  );

  // Project-override options for the threshold dialog: only initiatives whose
  // DB id is resolvable (real-provider mode). Empty in mock mode → the dialog
  // falls back to tier-default edits only.
  const initiativeOptions: ThresholdInitiativeOption[] = initiatives
    .filter((i) => !!i.initiativeId)
    .map((i) => ({ initiativeId: i.initiativeId as string, title: i.title, slug: i.slug }));

  const deploymentRows = details.flatMap((detail) =>
    detail
      ? detail.deployments.map((d) => ({
          slug: detail.summary.slug,
          title: detail.summary.title,
          initiativeId: detail.summary.initiativeId ?? null,
          state: detail.summary.state,
          deployment: d,
        }))
      : [],
  );

  const openIncidents = incidents.filter((i) => !i.resolvedAt);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
        <p className="text-sm text-muted-foreground">
          Narrow by design: threshold edits and pause/resume, both logged.
          Admin never approves, signs, or returns — anywhere.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Q-01 Eval quality floor — threshold</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-semibold tabular-nums">
                {q01?.threshold ?? "—"}
              </span>
              <div className="text-xs text-muted-foreground">
                <p>High-tier default (global). Critical-tier deployments use 0.05.</p>
                <p>Sustained window: 3 consecutive points · enforcement: block (pause deployment).</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Last changed: 30 days ago by Ray Chen — &ldquo;Q2 quality
              initiative&rdquo; (0.10 → 0.08).
            </p>
            <ThresholdEditAction
              currentThreshold={q01?.threshold ?? null}
              initiativeOptions={initiativeOptions}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run monitor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Synchronously evaluates Q-01 against current observation data
              for all deployments; applies pause + incident + reassessment on
              a sustained breach. Idempotent — re-running when already paused
              reports &ldquo;No new breaches detected.&rdquo;
            </p>
            <RunMonitorPanel withSelector />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Open incidents{openIncidents.length ? ` (${openIncidents.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-slot="no-incidents">
              No incidents recorded. Run the monitor to evaluate deployments
              against their eval-quality floor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected</TableHead>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Control</TableHead>
                  <TableHead>Window start</TableHead>
                  <TableHead>Reassessment</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((inc) => (
                  <TableRow key={inc.id} data-slot="incident-row">
                    <TableCell className="text-xs text-muted-foreground">
                      {inc.detectedAt.slice(0, 10)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{inc.deploymentId}</TableCell>
                    <TableCell>{inc.controlId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inc.windowStart.slice(0, 10)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {inc.reviewCycleId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={inc.resolvedAt ? "secondary" : "destructive"}>
                        {inc.resolvedAt ? "resolved" : "open"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deployments — pause / resume</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Deployment status</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deploymentRows.map((row) => (
                <TableRow key={`${row.slug}-${row.deployment.version}`}>
                  <TableCell>
                    <span className="font-medium">{row.title}</span>{" "}
                    <span className="text-xs text-muted-foreground">{row.slug}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.deployment.version}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.deployment.status === "deployed" ? "default" : "secondary"
                      }
                    >
                      {row.deployment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <LifecycleBadge state={row.state} />
                  </TableCell>
                  <TableCell>
                    <DeploymentActionButton
                      title={row.title}
                      initiativeId={row.initiativeId}
                      status={row.deployment.status}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Control-change audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q01Changes.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.eventTs ? row.eventTs.slice(0, 10) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal font-medium">
                    {row.title}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">
                    {row.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
