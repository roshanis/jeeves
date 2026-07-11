import { getAppProvider } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listIncidents, type IncidentListRow } from "@/lib/services/monitor-service";
import type { InitiativeSummary, InitiativeDetail } from "@/lib/data/dto";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";

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
  const [initiatives, incidents] = await Promise.all([
    provider.listInitiatives(),
    loadIncidents(),
  ]);
  const details = (
    await Promise.all(initiatives.map((i) => provider.getInitiativeDetail(i.slug)))
  ).filter((d): d is InitiativeDetail => d !== null);

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
    />
  );
}
