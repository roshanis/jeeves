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
  ShieldCheck,
} from "lucide-react";
import type { ControlRow, InitiativeSummary, DecisionRow, ReviewRow } from "@/lib/data/dto";
import type { Domain, LifecycleState, Tier } from "@/lib/domain/types";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import { LifecycleBadge } from "@/components/jeeves/lifecycle-badge";
import { TierBadge } from "@/components/jeeves/tier-badge";
import { ReviewStatusBadge, DOMAIN_LABEL } from "@/components/jeeves/domain-labels";
import { ControlStatusChip } from "@/components/jeeves/controls-tab";
import {
  QueueAgeCell,
  QueueAgingBadge,
  oldestUnsignedAgeMs,
  useClientNow,
} from "@/components/jeeves/queue-age";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  approved: { label: "Approved", icon: CheckCircle2, className: "text-status-good-fg" },
  conditionally_approved: {
    label: "Conditional approval",
    icon: FileCheck2,
    className: "text-status-warning-fg",
  },
  fast_lane_approved: { label: "Fast-lane approved", icon: CheckCircle2, className: "text-status-good-fg" },
  rejected: { label: "Rejected", icon: XCircle, className: "text-status-critical-fg" },
};

type DecisionEntry = { dec: DecisionRow; title: string; slug: string };

/** One initiative's slug/title/tier/state plus its reviews' domain+status —
 * enough for the reviewer Inbox view to scope a queue to a single domain
 * without needing a full InitiativeSummary. */
export interface DomainReviewRow {
  slug: string;
  title: string;
  tier: Tier;
  state: LifecycleState;
  reviews: { domain: Domain; status: ReviewRow["status"]; createdAt: string }[];
}

export interface EvalBreachRow {
  slug: string;
  title: string;
  state: LifecycleState;
}

/**
 * Instrument-panel stat tile: kicker label, mono stat-value figure, and a
 * small icon chip top-right that only picks up the semantic status color
 * when the metric is an actual problem count (tone !== "default" and
 * value > 0) — a zero-value "warn"/"alert" metric reads as neutral, since
 * zero of a bad thing is good news, not a warning.
 */
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
  const isProblem = tone !== "default" && value > 0;
  const chipClass = isProblem
    ? tone === "alert"
      ? "bg-status-critical-bg text-status-critical-fg"
      : "bg-status-warning-bg text-status-warning-fg"
    : "bg-status-neutral-bg text-muted-foreground";
  return (
    <div className="card-quiet flex flex-col gap-2.5 rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">{label}</span>
        <span className={`grid size-6 shrink-0 place-items-center rounded-md ${chipClass}`}>
          <Icon className="size-3.5" aria-hidden />
        </span>
      </div>
      <div className="stat-value text-2xl text-foreground">{value}</div>
    </div>
  );
}

function CardSectionHeader({ title }: { title: string }) {
  return (
    <CardHeader className="border-b py-2.5">
      <p className="kicker">{title}</p>
    </CardHeader>
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
    <Card className="card-quiet">
      <CardSectionHeader title="Operational alerts" />
      <CardContent className="p-0">
        {alerts.length === 0 && !hasIncidents ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No active alerts. Run the monitor from Administration to evaluate deployments.
          </p>
        ) : (
          <ul className="divide-y">
            {alerts.map((i) => (
              <li key={i.slug} className="flex items-start gap-2.5 px-4 py-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-critical-fg" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/initiatives/${i.slug}`}
                      className="truncate text-sm font-medium hover:text-primary hover:underline"
                    >
                      {i.title}
                    </Link>
                    {i.updatedAt ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {i.updatedAt.slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <LifecycleBadge state={i.state} />
                    {i.overdue ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-status-serious-fg">
                        <AlertTriangle className="size-3" aria-hidden /> SLA breached
                      </span>
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
    <Card className="card-quiet">
      <CardSectionHeader title={title} />
      <CardContent className="p-0">
        {recentDecisions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y">
            {recentDecisions.map(({ dec, title: initTitle, slug }, idx) => {
              const meta = DECISION_META[dec.type];
              const Icon = meta.icon;
              return (
                <li key={`${slug}-${idx}`} className="flex items-start gap-2.5 px-4 py-2.5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${meta.className}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/initiatives/${slug}`}
                        className="truncate text-sm font-medium hover:text-primary hover:underline"
                      >
                        {initTitle}
                      </Link>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {dec.at.slice(0, 10)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {meta.label} · {dec.approver}
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

/**
 * Compact "Viewing as" strip — sits inline in the page header row, right of
 * the heading, instead of a full-width band. Kicker + persona name + a role
 * chip so switching persona (top bar) is legible at a glance without eating
 * a full row of vertical space.
 */
function RoleContextStrip({ label, actorName }: { label: string; actorName: string }) {
  return (
    <div
      data-slot="role-context-strip"
      className="card-quiet flex shrink-0 items-center gap-2.5 self-start rounded-lg border bg-card px-3 py-2"
      title="Switch role in the top bar."
    >
      <div className="leading-tight">
        <p className="kicker">Viewing as</p>
        <p className="text-sm font-medium text-foreground">{actorName}</p>
      </div>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/** Shared page header row: eyebrow + heading + subhead on the left, the
 * compact role-context strip right-aligned alongside it. */
function PageHeader({
  eyebrow,
  heading,
  subheading,
}: {
  eyebrow: string;
  heading: string;
  subheading: React.ReactNode;
}) {
  const { persona } = useRole();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="kicker text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subheading}</p>
      </div>
      <RoleContextStrip label={persona.label} actorName={persona.actorName} />
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
  domainReviews,
  controls,
  evalBreaches,
}: {
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
  domainReviews: DomainReviewRow[];
  controls: ControlRow[];
  evalBreaches: EvalBreachRow[];
}) {
  const { roleKey, persona, reviewerDomain } = useRole();

  return (
    <div className="flex flex-col gap-6">
      <RoleView
        roleKey={roleKey}
        actorName={persona.actorName}
        reviewerDomain={reviewerDomain}
        initiatives={initiatives}
        recentDecisions={recentDecisions}
        alerts={alerts}
        incidentCount={incidentCount}
        counts={counts}
        domainReviews={domainReviews}
        controls={controls}
        evalBreaches={evalBreaches}
      />
    </div>
  );
}

function RoleView({
  roleKey,
  actorName,
  reviewerDomain,
  initiatives,
  recentDecisions,
  alerts,
  incidentCount,
  counts,
  domainReviews,
  controls,
  evalBreaches,
}: {
  roleKey: RoleKey;
  actorName: string;
  reviewerDomain: Domain | null;
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  alerts: InitiativeSummary[];
  incidentCount: number;
  counts: { inReview: number; slaBreaches: number; reassessing: number; deployed: number };
  domainReviews: DomainReviewRow[];
  controls: ControlRow[];
  evalBreaches: EvalBreachRow[];
}) {
  switch (roleKey) {
    case "requester":
      return (
        <RequesterView actorName={actorName} initiatives={initiatives} recentDecisions={recentDecisions} />
      );
    case "reviewer":
      return (
        <ReviewerView
          reviewerDomain={reviewerDomain}
          initiatives={initiatives}
          recentDecisions={recentDecisions}
          domainReviews={domainReviews}
          controls={controls}
          evalBreaches={evalBreaches}
        />
      );
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
      <PageHeader
        eyebrow="Program Office"
        heading="What needs attention"
        subheading={
          <>
            Meridian Health AI governance — {attention.length} of {initiatives.length}{" "}
            initiatives are waiting on someone right now.
          </>
        }
      />

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
      <PageHeader
        eyebrow="Requester"
        heading="Your initiatives"
        subheading="Initiatives you've submitted and what needs your input."
      />

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
 * Reviewer — domain-scoped queue for one of the 4 named domain reviewers
 * (Dr. Elena Vasquez / Clinical Safety, Marcus Webb / Privacy-HIPAA, Sofia
 * Grant / Responsible AI, James Liu / Legal). Each reviewer sees only their
 * own domain's pending/drafted/returned reviews, their own domain's
 * controls, and — for Responsible AI only — the eval-quality & fairness
 * breach signals. Evals belong to RAI, never to Legal or the other domains.
 * ---------------------------------------------------------------------- */
const DOMAIN_FOCUS: Record<Domain, string> = {
  legal: "Vendor contracts, AI addenda, liability & IP.",
  "privacy-hipaa": "BAA, PHI minimization, and DPIA evidence.",
  "responsible-ai": "Model cards, fairness testing, and eval quality.",
  "clinical-safety": "Clinician-in-the-loop and adverse-event monitoring.",
  security: "Threat modeling, access control, and vendor security posture.",
  "tech-architecture": "Integration design, scalability, and technical fit.",
  "data-governance": "Data lineage, retention, and quality controls.",
  procurement: "Vendor terms, sourcing, and contract lifecycle.",
};

const REVIEW_QUEUE_STATUSES = new Set<ReviewRow["status"]>(["pending", "drafted", "returned"]);

function DomainReviewQueueTable({
  rows,
  domain,
  nowMs,
}: {
  rows: DomainReviewRow[];
  domain: Domain;
  nowMs: number | null;
}) {
  if (rows.length === 0) {
    return (
      <div
        data-slot="initiative-table"
        className="card-quiet rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground"
      >
        Nothing awaiting your review right now.
      </div>
    );
  }

  return (
    <div
      className="scroll-thin card-quiet overflow-x-auto rounded-lg border bg-card"
      data-slot="initiative-table"
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">Reviews awaiting your signature</caption>
        <thead className="border-b bg-muted/50 text-[11px] uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Initiative</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tier</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Your review</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Age</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const review = row.reviews.find((r) => r.domain === domain);
            return (
              <tr
                key={row.slug}
                data-slot="initiative-row"
                className="h-11 border-b last:border-0 hover:bg-muted/40"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/initiatives/${row.slug}?tab=reviews`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {row.title}
                  </Link>
                  <div className="font-mono text-[11px] text-muted-foreground">{row.slug}</div>
                </td>
                <td className="px-3 py-2"><TierBadge tier={row.tier} /></td>
                <td className="px-3 py-2">
                  {review ? <ReviewStatusBadge status={review.status} /> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {review ? (
                    <QueueAgeCell createdAt={review.createdAt} status={review.status} nowMs={nowMs} />
                  ) : null}
                </td>
                <td className="px-3 py-2"><LifecycleBadge state={row.state} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvalQualityCard({ evalBreaches }: { evalBreaches: EvalBreachRow[] }) {
  return (
    <Card className="card-quiet">
      <CardSectionHeader title="Eval-quality & fairness signals" />
      <CardContent className="p-0">
        {evalBreaches.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No eval-quality breaches right now.
          </p>
        ) : (
          <ul className="divide-y">
            {evalBreaches.map((b) => (
              <li key={b.slug} className="flex items-start gap-2.5 px-4 py-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-critical-fg" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/initiatives/${b.slug}?tab=evals`}
                    className="text-sm font-medium hover:text-primary hover:underline"
                  >
                    {b.title}
                  </Link>
                  <div className="mt-1">
                    <LifecycleBadge state={b.state} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-3">
          <ViewLink href="/admin">Open Monitoring</ViewLink>
        </div>
      </CardContent>
    </Card>
  );
}

function DomainControlsCard({ domain, controls }: { domain: Domain; controls: ControlRow[] }) {
  const mine = controls.filter((c) => c.domain === domain);
  return (
    <Card className="card-quiet">
      <CardSectionHeader title={`${DOMAIN_LABEL[domain]} controls`} />
      <CardContent className="p-0">
        {mine.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No controls catalogued for this domain yet.
          </p>
        ) : (
          <ul className="divide-y">
            {mine.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2.5 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>{" "}
                  <span className="text-sm font-medium">{c.name}</span>
                </div>
                <ControlStatusChip status={c.status} />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-3">
          <ViewLink href="/controls">Open Controls catalog</ViewLink>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewerView({
  reviewerDomain,
  initiatives,
  recentDecisions,
  domainReviews,
  controls,
  evalBreaches,
}: {
  reviewerDomain: Domain | null;
  initiatives: InitiativeSummary[];
  recentDecisions: DecisionEntry[];
  domainReviews: DomainReviewRow[];
  controls: ControlRow[];
  evalBreaches: EvalBreachRow[];
}) {
  const nowMs = useClientNow();

  // Guard: a reviewer persona should always resolve a domain. If somehow
  // null, fall back to the original generic reviewer view.
  if (!reviewerDomain) {
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
        <PageHeader
          eyebrow="Reviewer"
          heading="Your review queue"
          subheading="This demo isn't filtered to one reviewer's assignments — it shows every initiative awaiting a domain signature."
        />

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

  const queue = domainReviews.filter((d) =>
    d.reviews.some((r) => r.domain === reviewerDomain && REVIEW_QUEUE_STATUSES.has(r.status)),
  );
  const draftedCount = queue.filter((d) =>
    d.reviews.some((r) => r.domain === reviewerDomain && r.status === "drafted"),
  ).length;
  const returnedCount = queue.filter((d) =>
    d.reviews.some((r) => r.domain === reviewerDomain && r.status === "returned"),
  ).length;
  const myControlsCount = controls.filter((c) => c.domain === reviewerDomain).length;
  // Oldest still-waiting review in this reviewer's own domain queue.
  const queueDomainReviews = queue.flatMap((d) =>
    d.reviews.filter((r) => r.domain === reviewerDomain),
  );
  const oldestQueueAgeMs = oldestUnsignedAgeMs(queueDomainReviews, nowMs);

  return (
    <>
      <PageHeader
        eyebrow="Reviewer"
        heading={`Your ${DOMAIN_LABEL[reviewerDomain]} reviews`}
        subheading={DOMAIN_FOCUS[reviewerDomain]}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ClipboardCheck} value={queue.length} label="Awaiting my review" />
        <StatTile icon={FileClock} value={draftedCount} label="Drafted" />
        <StatTile icon={AlertTriangle} value={returnedCount} label="Returned" tone="warn" />
        <StatTile icon={ShieldCheck} value={myControlsCount} label="My domain controls" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center text-sm font-semibold">
              Reviews awaiting signature <span className="ml-1 text-muted-foreground">({queue.length})</span>
              <QueueAgingBadge ageMs={oldestQueueAgeMs} />
            </h2>
            <ViewLink href="/reviews">Open Reviews workbench</ViewLink>
          </div>
          <DomainReviewQueueTable rows={queue} domain={reviewerDomain} nowMs={nowMs} />
        </section>

        <div className="flex flex-col gap-6">
          {reviewerDomain === "responsible-ai" ? (
            <EvalQualityCard evalBreaches={evalBreaches} />
          ) : (
            <DomainControlsCard domain={reviewerDomain} controls={controls} />
          )}
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
      <PageHeader
        eyebrow="Audit / Leadership"
        heading="Decisions & approvals"
        subheading="Oversight of what's awaiting your decision and what's already been decided."
      />

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
      <PageHeader
        eyebrow="Admin"
        heading="Operations & controls"
        subheading="Runtime enforcement — paused deployments, open incidents, and SLA health."
      />

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
