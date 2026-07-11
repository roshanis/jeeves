"use client";

// Role-aware Inbox landing (ui-spec §2 role-aware saved views). The Inbox
// route (`/`, app/page.tsx) loads the same server-side data for every demo
// user, but this component renders a DIFFERENT saved view per selected role:
// each persona gets its own eyebrow/heading/subhead, its own filtered
// primary InitiativeTable, and its own side cards — reusing the identical
// StatTile / decision-icon / alerts-list building blocks so the dashboards
// stay visually consistent. Switching role (components/jeeves/role-context.tsx)
// never re-fetches data; it only changes which of these views renders.
//
// The "program" role is the DEFAULT demo role and reproduces today's
// original Inbox exactly (same heading, same attention filter, same side
// cards) so the read-only e2e golden path — which loads `/` with no role
// switch — keeps passing.
import * as React from "react";
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
  FilePlus2,
  FileClock,
  ClipboardCheck,
  Gavel,
} from "lucide-react";
import type { InitiativeSummary, DecisionRow } from "@/lib/data/dto";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { useRole, type RoleKey } from "@/components/jeeves/role-context";

// Same attention set as the original Inbox (app/page.tsx) — kept here so the
// "program" (default) view's primary table filter is unchanged.
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

type DecisionEntry = { dec: DecisionRow; title: string; slug: string };

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

function OperationalAlertsCard({
  alerts,
  hasIncidents,
}: {
  alerts: InitiativeSummary[];
  hasIncidents: boolean;
}) {
  return (
    <Card>
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="text-sm">Operational alerts</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 && !hasIncidents ? (
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
  );
}

function RecentDecisionsCard({
  recentDecisions,
  title = "Recent decisions",
  emptyText = "No decisions recorded yet.",
}: {
  recentDecisions: DecisionEntry[];
  title?: string;
  emptyText?: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {recentDecisions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y">
            {recentDecisions.map(({ dec, title: initTitle, slug }, idx) => {
              const meta = DECISION_META[dec.type];
              const Icon = meta.icon;
              return (
                <li key={`${slug}-${idx}`} className="flex items-start gap-2.5 px-4 py-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/initiatives/${slug}`} className="text-sm font-medium hover:text-primary hover:underline">
                      {initTitle}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {meta.label} · {dec.approver} · {dec.at.slice(0, 10)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RoleContextStrip({ label, actorName }: { label: string; actorName: string }) {
  return (
    <div
      data-slot="role-context-strip"
      className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:text-sm"
    >
      <span>
        Viewing as <span className="font-medium text-foreground">{label}</span> ·{" "}
        {actorName}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        Switch role in the top bar.
      </span>
    </div>
  );
}

function ViewLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

export function RoleAwareInbox({
  initiatives,
  recentDecisions,
  alerts,
  incidentCount,
  counts,
}: {
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
}) {
  const { roleKey, persona } = useRole();

  return (
    <div className="flex flex-col gap-6">
      <RoleContextStrip label={persona.label} actorName={persona.actorName} />
      <RoleView
        roleKey={roleKey}
        actorName={persona.actorName}
        initiatives={initiatives}
        recentDecisions={recentDecisions}
        alerts={alerts}
        incidentCount={incidentCount}
        counts={counts}
      />
    </div>
  );
}

function RoleView({
  roleKey,
  actorName,
  initiatives,
  recentDecisions,
  alerts,
  incidentCount,
  counts,
}: {
  roleKey: RoleKey;
  actorName: string;
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
}) {
  switch (roleKey) {
    case "requester":
      return (
        <RequesterView actorName={actorName} initiatives={initiatives} recentDecisions={recentDecisions} />
      );
    case "reviewer":
      return <ReviewerView initiatives={initiatives} recentDecisions={recentDecisions} />;
    case "audit":
      return (
        <AuditView initiatives={initiatives} recentDecisions={recentDecisions} />
      );
    case "admin":
      return (
        <AdminView
          initiatives={initiatives}
          alerts={alerts}
          incidentCount={incidentCount}
          counts={counts}
        />
      );
    case "program":
    default:
      return (
        <ProgramView
          initiatives={initiatives}
          recentDecisions={recentDecisions}
          alerts={alerts}
          incidentCount={incidentCount}
          counts={counts}
        />
      );
  }
}

/* -------------------------------------------------------------------------
 * Program Office — DEFAULT view. Reproduces the original Inbox exactly.
 * ---------------------------------------------------------------------- */
function ProgramView({
  initiatives,
  recentDecisions,
  alerts,
  incidentCount,
  counts,
}: {
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
}) {
  const attention = initiatives.filter(
    (i) => ATTENTION_STATES.has(i.state) || i.overdue,
  );

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Program Office
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">What needs attention</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Meridian Health AI governance — {attention.length} of {initiatives.length}{" "}
          initiatives are waiting on someone right now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ClipboardList} value={counts.inReview} label="In review" />
        <StatTile icon={AlertTriangle} value={counts.slaBreaches} label="SLA breaches" tone="warn" />
        <StatTile icon={PauseCircle} value={counts.reassessing} label="Paused / reassessing" tone="alert" />
        <StatTile icon={ShieldAlert} value={alerts.length} label="Operational alerts" tone="alert" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Needs attention <span className="text-muted-foreground">({attention.length})</span>
            </h2>
            <ViewLink href="/portfolio">Full portfolio</ViewLink>
          </div>
          <InitiativeTable initiatives={attention} caption="Initiatives needing attention" />
        </section>

        <div className="flex flex-col gap-6">
          <OperationalAlertsCard alerts={alerts} hasIncidents={incidentCount > 0} />
          <RecentDecisionsCard recentDecisions={recentDecisions} />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Requester — Priya Raman's "Your initiatives" saved view.
 * ---------------------------------------------------------------------- */
function RequesterView({
  actorName,
  initiatives,
  recentDecisions,
}: {
  actorName: string;
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
}) {
  const mine = initiatives.filter((i) => i.requester === actorName);
  const mineSlugs = new Set(mine.map((i) => i.slug));
  const drafts = mine.filter((i) => i.state === "intake_draft").length;
  const inReview = mine.filter((i) => i.state === "in_review").length;
  const needsInput = mine.filter(
    (i) => i.state === "intake_draft" || i.state === "conditionally_approved",
  ).length;
  const deployedCount = mine.filter(
    (i) => i.state === "deployed" || i.state === "fast_lane_approved",
  ).length;
  const myDecisions = recentDecisions.filter((d) => mineSlugs.has(d.slug));

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Requester</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your initiatives</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Initiatives you&apos;ve submitted and what needs your input.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={FilePlus2} value={drafts} label="Drafts" />
        <StatTile icon={FileClock} value={inReview} label="In review" />
        <StatTile icon={AlertTriangle} value={needsInput} label="Needs your input" tone="warn" />
        <StatTile icon={CheckCircle2} value={deployedCount} label="Deployed" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Your initiatives <span className="text-muted-foreground">({mine.length})</span>
            </h2>
            <Link href="/initiatives/new" className={buttonVariants({ size: "sm" })}>
              New initiative
            </Link>
          </div>
          <InitiativeTable initiatives={mine} caption="Your initiatives" />
        </section>

        <div className="flex flex-col gap-6">
          <RecentDecisionsCard
            recentDecisions={myDecisions}
            title="Recent decisions on your initiatives"
            emptyText="No decisions recorded yet for your initiatives."
          />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Reviewer — Dr. Elena Vasquez's review queue.
 * ---------------------------------------------------------------------- */
function ReviewerView({
  initiatives,
  recentDecisions,
}: {
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
}) {
  const queue = initiatives.filter(
    (i) => i.state === "in_review" && i.domainsSigned < i.domainsRequired,
  );
  const inReviewCount = initiatives.filter((i) => i.state === "in_review").length;
  const returned = initiatives.filter((i) => i.overdue).length;
  const signedThrough = initiatives.filter(
    (i) => i.state === "in_review" && i.domainsSigned === i.domainsRequired,
  ).length;

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Reviewer</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your review queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This demo isn&apos;t filtered to one reviewer&apos;s assignments — it shows every
          initiative awaiting a domain signature.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ClipboardCheck} value={queue.length} label="Awaiting review" />
        <StatTile icon={FileClock} value={inReviewCount} label="In review" />
        <StatTile icon={AlertTriangle} value={returned} label="Returned / overdue" tone="warn" />
        <StatTile icon={CheckCircle2} value={signedThrough} label="Signed-through" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Reviews awaiting signature <span className="text-muted-foreground">({queue.length})</span>
            </h2>
            <ViewLink href="/reviews">Open Reviews workbench</ViewLink>
          </div>
          <InitiativeTable initiatives={queue} caption="Reviews awaiting signature" />
        </section>

        <div className="flex flex-col gap-6">
          <RecentDecisionsCard recentDecisions={recentDecisions} />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Audit / Leadership — Angela Torres's decisions & approvals queue.
 * ---------------------------------------------------------------------- */
function AuditView({
  initiatives,
  recentDecisions,
}: {
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
}) {
  const awaitingDecision = initiatives.filter(
    (i) =>
      (i.state === "in_review" && i.domainsSigned === i.domainsRequired) ||
      i.state === "conditionally_approved",
  );
  const approvedCount = recentDecisions.filter(
    (d) => d.dec.type === "approved" || d.dec.type === "fast_lane_approved",
  ).length;
  const conditionalCount = recentDecisions.filter(
    (d) => d.dec.type === "conditionally_approved",
  ).length;
  const rejectedCount = recentDecisions.filter((d) => d.dec.type === "rejected").length;

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Audit / Leadership
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Decisions &amp; approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Oversight of what&apos;s awaiting your decision and what&apos;s already been decided.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Gavel} value={awaitingDecision.length} label="Awaiting decision" tone="warn" />
        <StatTile icon={CheckCircle2} value={approvedCount} label="Approved" />
        <StatTile icon={FileCheck2} value={conditionalCount} label="Conditional" />
        <StatTile icon={XCircle} value={rejectedCount} label="Rejected" tone="alert" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Awaiting your decision{" "}
              <span className="text-muted-foreground">({awaitingDecision.length})</span>
            </h2>
            <ViewLink href="/audit">Open Audit console</ViewLink>
          </div>
          <InitiativeTable initiatives={awaitingDecision} caption="Awaiting your decision" />
        </section>

        <div className="flex flex-col gap-6">
          <RecentDecisionsCard recentDecisions={recentDecisions} />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Admin — Ray Chen's operations & controls.
 * ---------------------------------------------------------------------- */
function AdminView({
  initiatives,
  alerts,
  incidentCount,
  counts,
}: {
  initiatives: InitiativeSummary[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
}) {
  const paused = initiatives.filter((i) => i.state === "paused" || i.state === "re_review");

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Operations &amp; controls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Runtime enforcement — paused deployments, open incidents, and SLA health.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={PauseCircle} value={paused.length} label="Paused deployments" tone="alert" />
        <StatTile icon={ShieldAlert} value={incidentCount} label="Open incidents" tone="alert" />
        <StatTile icon={CheckCircle2} value={counts.deployed} label="Deployed models" />
        <StatTile icon={AlertTriangle} value={counts.slaBreaches} label="SLA breaches" tone="warn" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Paused / reassessing <span className="text-muted-foreground">({paused.length})</span>
            </h2>
            <ViewLink href="/admin">Open Administration</ViewLink>
          </div>
          <InitiativeTable initiatives={paused} caption="Paused / reassessing" />
        </section>

        <div className="flex flex-col gap-6">
          <OperationalAlertsCard alerts={alerts} hasIncidents={incidentCount > 0} />
        </div>
      </div>
    </>
  );
}
