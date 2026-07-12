import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import type { InitiativeSummary, InitiativeDetail } from "@/lib/data/dto";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";

// Eval-quality telemetry kinds that feed the Responsible AI reviewer's
// side panel (components/jeeves/role-aware-inbox.tsx) — a breach is any
// point that crosses its series' threshold.
const EVAL_KINDS = new Set(["eval_hallucination", "eval_relevance"]);

// ATTENTION_STATES now lives only in components/jeeves/role-aware-inbox.tsx
// (the "program" role's primary-table filter) — kept consistent there with
// the original set used here before the role-aware Inbox split.

async function loadIncidents(): Promise<IncidentListRow[]> {
  const dbMode = process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (!dbMode) return [];
  try {
    return await listIncidents(getDb());
  } catch {
    return [];
  }
}

export default async function InboxPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const [initiatives, incidents, controls] = await Promise.all([
    provider.listInitiatives({ viewerWorkspaceId }),
    loadIncidents(),
    provider.controlCatalog(),
  ]);
  const details = (
    await Promise.all(
      initiatives.map((i) => provider.getInitiativeDetail(i.slug, { viewerWorkspaceId })),
    )
  ).filter((d): d is InitiativeDetail => d !== null);

  // Domain-scoped review rows for the reviewer Inbox view (one row per
  // initiative, carrying just its reviews' domain+status) — lets each of
  // the 4 named domain reviewers see only their own queue.
  const domainReviews = details.map((d) => ({
    slug: d.summary.slug,
    title: d.summary.title,
    tier: d.summary.tier,
    state: d.summary.state,
    reviews: d.reviews.map((r) => ({ domain: r.domain, status: r.status })),
  }));

  // Eval-quality breaches: initiatives whose eval telemetry series has a
  // threshold and at least one observed point crosses it. This is the
  // Responsible AI reviewer's signal set — evals belong to RAI, not Legal.
  const evalBreaches = details
    .filter((d) =>
      d.telemetry.some(
        (series) =>
          EVAL_KINDS.has(series.kind) &&
          series.threshold !== null &&
          series.points.some((p) => p.value > series.threshold!),
      ),
    )
    .map((d) => ({
      slug: d.summary.slug,
      title: d.summary.title,
      state: d.summary.state,
    }));

  const inReview = initiatives.filter((i) => i.state === "in_review").length;
  const slaBreaches = initiatives.filter((i) => i.overdue).length;
  const reassessing = initiatives.filter(
    (i) => i.state === "paused" || i.state === "re_review",
  ).length;
  const deployed = initiatives.filter(
    (i) => i.state === "deployed" || i.state === "fast_lane_approved",
  ).length;

  const recentDecisions = details
    .flatMap((d) =>
      d.decisions.map((dec) => ({ dec, title: d.summary.title, slug: d.summary.slug })),
    )
    .sort((a, b) => (a.dec.at < b.dec.at ? 1 : -1))
    .slice(0, 6);

  const alerts = initiatives.filter(
    (i: InitiativeSummary) => i.state === "paused" || i.state === "re_review" || i.overdue,
  );

  return (
    <RoleAwareInbox
      initiatives={initiatives}
      recentDecisions={recentDecisions}
      alerts={alerts}
      incidentCount={incidents.length}
      counts={{ inReview, slaBreaches, reassessing, deployed }}
      domainReviews={domainReviews}
      controls={controls}
      evalBreaches={evalBreaches}
    />
  );
}
