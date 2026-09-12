import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
import { loadIncidentsForViewer } from "@/app/_lib/incident-data";
import { IncidentDataNotice } from "@/components/jeeves/incident-data-notice";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import type { InitiativeSummary } from "@/lib/data/dto";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";

// Eval-quality telemetry kinds that feed the Responsible AI reviewer's
// side panel — compare the latest recorded reading with its threshold.
const EVAL_KINDS = new Set(["eval_hallucination", "eval_relevance"]);

export default async function InboxPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const [details, incidentResult, controls] = await Promise.all([
    loadPortfolioDetails(provider, viewerWorkspaceId),
    loadIncidentsForViewer(viewerWorkspaceId),
    provider.controlCatalog({ viewerWorkspaceId }),
  ]);
  const initiatives = details.map((detail) => detail.summary);

  // Domain-scoped review rows for the reviewer Inbox view (one row per
  // initiative, carrying just its reviews' domain+status) — lets each of
  // the 4 named domain reviewers see only their own queue.
  const domainReviews = details.map((d) => ({
    slug: d.summary.slug,
    title: d.summary.title,
    tier: d.summary.tier,
    state: d.summary.state,
    reviews: d.reviews.map((r) => ({ domain: r.domain, status: r.status, createdAt: r.createdAt })),
  }));

  // Eval-quality breaches: initiatives whose eval telemetry series has a
  // threshold and whose latest observed point crosses it. This is the
  // Responsible AI reviewer's signal set — evals belong to RAI, not Legal.
  const evalBreaches = details
    .filter((d) =>
      d.telemetry.some(
        (series) =>
          EVAL_KINDS.has(series.kind) &&
          series.threshold !== null &&
          series.points.length > 0 &&
          series.points[series.points.length - 1]!.value > series.threshold,
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
    <>
    {incidentResult.status === "unavailable" ? <IncidentDataNotice reason={incidentResult.reason} /> : null}
    <RoleAwareInbox
      initiatives={initiatives}
      recentDecisions={recentDecisions}
      alerts={alerts}
      incidentCount={incidentResult.status === "success" ? incidentResult.incidents.filter((incident) => !incident.resolvedAt).length : null}
      counts={{ inReview, slaBreaches, reassessing, deployed }}
      domainReviews={domainReviews}
      controls={controls}
      evalBreaches={evalBreaches}
    />
    </>
  );
}
