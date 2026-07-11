import Link from "next/link";
import {
  ClipboardList,
  AlertTriangle,
  PauseCircle,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  XCircle,
  FileCheck2,
} from "lucide-react";
import { getAppProvider } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import type { InitiativeSummary, InitiativeDetail, DecisionRow } from "@/lib/data/dto";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ATTENTION_STATES = new Set([
  "intake_draft",
  "submitted",
  "triaged",
  "in_review",
  "conditionally_approved",
  "paused",
  "re_review",
]);

const DECISION_META: Record<
  DecisionRow["type"],
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  approved: { label: "Approved", icon: CheckCircle2, className: "text-emerald-600" },
  conditionally_approved: { label: "Conditional approval", icon: FileCheck2, className: "text-amber-600" },
  fast_lane_approved: { label: "Fast-lane approved", icon: CheckCircle2, className: "text-emerald-600" },
  rejected: { label: "Rejected", icon: XCircle, className: "text-destructive" },
};

async function loadIncidents(): Promise<IncidentListRow[]> {
  const dbMode = process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (!dbMode) return [];
  try {
    return await listIncidents(getDb());
  } catch {
    return [];
  }
}

function StatTile({
  icon: Icon,
  value,
  label,
  tone = "default",
}: {
  icon: typeof ClipboardList;
  value: number;
  label: string;
  tone?: "default" | "warn" | "alert";
}) {
  const toneClass =
    tone === "alert"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600"
        : "text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-3.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <div className="text-xl font-semibold tabular-nums leading-none">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function InboxPage() {
  const provider = getAppProvider();
  const [initiatives, incidents] = await Promise.all([
    provider.listInitiatives(),
    loadIncidents(),
  ]);
  const details = (
    await Promise.all(initiatives.map((i) => provider.getInitiativeDetail(i.slug)))
  ).filter((d): d is InitiativeDetail => d !== null);

  const attention = initiatives.filter(
    (i: InitiativeSummary) => ATTENTION_STATES.has(i.state) || i.overdue,
  );
  const inReview = initiatives.filter((i) => i.state === "in_review").length;
  const slaBreaches = initiatives.filter((i) => i.overdue).length;
  const reassessing = initiatives.filter(
    (i) => i.state === "paused" || i.state === "re_review",
  ).length;

  const recentDecisions = details
    .flatMap((d) =>
      d.decisions.map((dec) => ({ dec, title: d.summary.title, slug: d.summary.slug })),
    )
    .sort((a, b) => (a.dec.at < b.dec.at ? 1 : -1))
    .slice(0, 6);

  const alerts = initiatives.filter(
    (i) => i.state === "paused" || i.state === "re_review" || i.overdue,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Operations
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          What needs attention
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Meridian Health AI governance — {attention.length} of {initiatives.length}{" "}
          initiatives are waiting on someone right now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ClipboardList} value={inReview} label="In review" />
        <StatTile icon={AlertTriangle} value={slaBreaches} label="SLA breaches" tone="warn" />
        <StatTile icon={PauseCircle} value={reassessing} label="Paused / reassessing" tone="alert" />
        <StatTile icon={ShieldAlert} value={alerts.length} label="Operational alerts" tone="alert" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Needs attention <span className="text-muted-foreground">({attention.length})</span>
            </h2>
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Full portfolio <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <InitiativeTable initiatives={attention} caption="Initiatives needing attention" />
        </section>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="border-b bg-muted/40 py-3">
              <CardTitle className="text-sm">Operational alerts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {alerts.length === 0 && incidents.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  No active alerts. Run the monitor from Administration to evaluate deployments.
                </p>
              ) : (
                <ul className="divide-y">
                  {alerts.map((i) => (
                    <li key={i.slug} className="flex items-start gap-2.5 px-4 py-3">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                      <div className="min-w-0">
                        <Link href={`/initiatives/${i.slug}`} className="text-sm font-medium hover:text-primary hover:underline">
                          {i.title}
                        </Link>
                        <div className="mt-1 flex items-center gap-2">
                          <LifecycleBadge state={i.state} />
                          {i.overdue ? (
                            <span className="text-xs text-destructive">SLA breached</span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/40 py-3">
              <CardTitle className="text-sm">Recent decisions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {recentDecisions.map(({ dec, title, slug }, idx) => {
                  const meta = DECISION_META[dec.type];
                  const Icon = meta.icon;
                  return (
                    <li key={`${slug}-${idx}`} className="flex items-start gap-2.5 px-4 py-3">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden />
                      <div className="min-w-0">
                        <Link href={`/initiatives/${slug}`} className="text-sm font-medium hover:text-primary hover:underline">
                          {title}
                        </Link>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {meta.label} · {dec.approver} · {dec.at.slice(0, 10)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
