import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
import { loadIncidentsForViewer } from "@/app/_lib/incident-data";
import { IncidentDataNotice } from "@/components/jeeves/incident-data-notice";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
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

export default async function AdminPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const [catalog, details, q01Changes, incidentResult] = await Promise.all([
    provider.controlCatalog({ viewerWorkspaceId }),
    loadPortfolioDetails(provider, viewerWorkspaceId),
    provider.auditQuery("q01-control-changes", { viewerWorkspaceId }),
    loadIncidentsForViewer(viewerWorkspaceId),
  ]);

  const q01 = catalog.find((c) => c.id === "Q-01");
  const initiatives = details.map((detail) => detail.summary);
  const incidents = incidentResult.incidents ?? [];

  // Project-override options for the threshold dialog: only initiatives whose
  // DB id is resolvable (real-provider mode). Empty in mock mode → the dialog
  // falls back to tier-default edits only.
  const initiativeOptions: ThresholdInitiativeOption[] = initiatives
    .filter((i) => !!i.initiativeId && !i.isSeeded)
    .map((i) => ({ initiativeId: i.initiativeId as string, title: i.title, slug: i.slug }));

  const deploymentRows = details.flatMap((detail) =>
    detail
      ? detail.deployments.map((d) => ({
          slug: detail.summary.slug,
          title: detail.summary.title,
          initiativeId: detail.summary.isSeeded ? null : detail.summary.initiativeId ?? null,
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
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/40 py-2.5">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Q-01 · Eval-quality floor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-0">
            {/* Restrained threshold table (Codex design review): the effective
                value read across scopes, with the one mutable action kept
                visually secondary in the footer rather than a prominent
                big-number CTA. Per-initiative override values live behind the
                edit dialog — not fabricated here. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Enforcement</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">High-tier default (global)</TableCell>
                  <TableCell className="tabular-nums">{q01?.threshold ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    block · 3-point window
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">Enforced</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Critical-tier default</TableCell>
                  <TableCell className="tabular-nums">0.05</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    block · 3-point window
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">Enforced</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    Per-initiative overrides
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" colSpan={2}>
                    Configured via the threshold editor
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {initiativeOptions.length} configurable
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                Every edit requires a reason. Recorded changes appear in the control-change audit log below.
              </p>
              <ThresholdEditAction
                currentThreshold={q01?.threshold ?? null}
                initiativeOptions={initiativeOptions}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run monitor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Synchronously evaluates Q-01 against current observation data
              for deployed versions in your workspace. A sustained breach creates
              an incident, pauses the deployment, and opens reassessment.
              Re-running does not duplicate an existing incident.
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
          {incidentResult.status === "unavailable" ? (
            <IncidentDataNotice reason={incidentResult.reason} />
          ) : incidents.length === 0 ? (
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
                    {row.initiativeId ? <DeploymentActionButton
                      title={row.title}
                      initiativeId={row.initiativeId}
                      status={row.deployment.status}
                    /> : <span className="text-xs text-muted-foreground">Read-only example</span>}
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
